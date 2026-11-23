// A running home's bot computers need docker and the docker gate in front of it. Either can stop answering while the
// machine keeps running (a docker restart the gate did not follow, a gate wedged on an older package's code), and
// nothing on the machine brings it back before a reboot. The reconciler checks after every wake and every
// COMPUTER_CHECK_MS while a home runs, with a command that repairs what it finds (home.ts COMPUTER_CHECK_SCRIPT). A
// repair that worked is only audited; the operator hears once when DOWN_ALERT_CHECKS repairs in a row did not bring it
// back, and once when it answers again. The update guard reads the history so a release is not blamed for runs that
// failed because the computer was down.
import type { StoredCloud } from "../../dashboard/server/clouds/types.ts";
import { outageEntry } from "./audit.ts";
import type { Audit, AuditEntry } from "./audit.ts";
import type { MachineImage, MachineProvider } from "./provider.ts";

export const COMPUTER_CHECK_MS = 10 * 60_000;
/** checks in a row that restarted docker or the gate and still found it down before the operator is emailed */
export const DOWN_ALERT_CHECKS = 2;
const HISTORY = 40;

export type ComputerHealth = "ok" | "healed" | "down" | "none" | "unknown";
export interface ComputerCheck {
  at: number;
  health: ComputerHealth;
  /** what the check repaired: units, docker, gate (not answering), gate-code (running an older package's gate) */
  fixed: string[];
  down: "docker" | "gate" | null;
  /** docker or the gate was not answering: bot computers could not be reached until this check */
  infra: boolean;
}
export interface ComputerState {
  last: ComputerCheck | null;
  /** recent checks, oldest first: [at, infra] */
  history: Array<[number, boolean]>;
  /** an open incident (docker or the gate down after its repair), closed by the next check that finds it answering;
   *  `downs` counts its checks, `alerted` whether the operator was told */
  incident: { since: number; what: string; downs?: number; alerted?: boolean } | null;
}

export function parseComputerCheck(stdout: string, at: number): ComputerCheck {
  const words = stdout.trim().split("\n").at(-1)?.trim().split(/\s+/) ?? [];
  const head = words[0] ?? "";
  if (head === "ok" || head === "none") return { at, health: head, fixed: [], down: null, infra: false };
  if (head === "healed") {
    const fixed = words.slice(1).filter(w => /^[a-z-]{1,20}$/.test(w));
    return { at, health: "healed", fixed, down: null, infra: fixed.includes("docker") || fixed.includes("gate") };
  }
  if (head === "down" && (words[1] === "docker" || words[1] === "gate")) return { at, health: "down", fixed: [], down: words[1], infra: true };
  return { at, health: "unknown", fixed: [], down: null, infra: false };
}

export interface ComputerHealthDeps {
  provider: MachineProvider;
  image: MachineImage;
  audit: Audit;
  alert?(entry: AuditEntry): void;
  now(): number;
  save(cloud: StoredCloud): void;
}

export function createComputerHealth(deps: ComputerHealthDeps) {
  const stateOf = (c: StoredCloud): ComputerState => {
    const s = (c.managed!.computer ??= { last: null, history: [], incident: null });
    if (!Array.isArray(s.history)) s.history = [];
    return s;
  };
  const log = (c: StoredCloud, action: string, reason: string, detail?: Record<string, string | number | boolean | null>) =>
    deps.audit.record({ cloudId: c.id, action, actor: "reconciler", reason, serverId: c.serverId, ...(detail ? { detail } : {}) });

  const outageKey = (c: StoredCloud, since: number) => `computer-${c.id}-${since}`;
  const outageTitle = (c: StoredCloud) => `cloud ${c.id.slice(0, 8)}: bot computers down`;
  const minutes = (ms: number) => `${Math.max(1, Math.round(ms / 60_000))} min`;

  function record(c: StoredCloud, why: string, check: ComputerCheck) {
    const s = stateOf(c);
    s.last = check;
    if (check.health !== "unknown") s.history = [...s.history, [check.at, check.infra] as [number, boolean]].slice(-HISTORY);
    if (check.health === "healed") log(c, "computer_healed", why, { fixed: check.fixed.join(":") });
    if (check.down) {
      const what = `down_${check.down}`, open = s.incident;
      if (!open || open.what !== what) log(c, "computer_down", why, { what: check.down });
      const incident = { since: open?.since ?? check.at, what, downs: (open?.downs ?? 0) + 1, alerted: open?.alerted ?? false };
      s.incident = incident;
      if (!incident.alerted && incident.downs >= DOWN_ALERT_CHECKS) {
        incident.alerted = true;
        const part = check.down === "docker" ? "docker" : "the docker gate";
        const text = `cloud ${c.id}: its bot computers cannot be reached: ${part} stopped answering and did not come back after `
          + `${incident.downs} restarts over ${minutes(check.at - incident.since)}. bot work that needs a computer fails on this cloud until it does. `
          + `look at journalctl -u ${check.down === "docker" ? "docker" : "omb-docker-gate"} on its machine.`;
        console.log(`managed: ${text}`);
        deps.alert?.(outageEntry(true, check.at, c.id, outageKey(c, incident.since), outageTitle(c), text));
      }
    } else if (s.incident && check.health !== "unknown") {
      log(c, "computer_ok", "recovered", { since: s.incident.since, was: s.incident.what });
      if (s.incident.alerted) {
        deps.alert?.(outageEntry(false, check.at, c.id, outageKey(c, s.incident.since), outageTitle(c),
          `cloud ${c.id}: its bot computers answer again${check.fixed.length ? ` (${check.fixed.join(", ")} restarted)` : ""}, after ${minutes(check.at - s.incident.since)} down.`));
      }
      s.incident = null;
    }
    deps.save(c);
  }

  return {
    /** whether the periodic check is due */
    due(c: StoredCloud): boolean {
      const last = c.managed?.computer?.last?.at ?? null;
      return last === null || deps.now() - last >= COMPUTER_CHECK_MS;
    },
    /** checks and repairs the home's docker and gate, unless a check ran at or after `notBefore` (default: now); never
     *  throws. `refreshGate` only while the home is idle: a gate that answers but runs an older package's code restarts */
    async check(c: StoredCloud, why: string, notBefore = deps.now(), refreshGate = false): Promise<ComputerCheck | null> {
      if (!c.serverId || !c.managed) return null;
      const s = stateOf(c);
      if (s.last && s.last.health !== "unknown" && s.last.at >= notBefore) return s.last;
      let stdout: string;
      try {
        const done = await deps.provider.run(c.serverId, deps.image.computerCheckCommand(refreshGate), 240);
        stdout = done.stdout;
      } catch (error) {
        console.warn(`managed: the computer check of ${c.id} could not run: ${(error as Error).message}`);
        return null;
      }
      const check = parseComputerCheck(stdout, deps.now());
      record(c, why, check);
      return check;
    },
    /** whether the last check found docker or the gate down and did not bring it back, less than COMPUTER_CHECK_MS ago:
     *  checking again before then would only hold a reconciler lane for the repair's minutes */
    downRecently(c: StoredCloud): boolean {
      const last = c.managed?.computer?.last;
      return last?.health === "down" && deps.now() - last.at < COMPUTER_CHECK_MS;
    },
    /** whether the first check at or after `at` found docker or the gate not answering: a run that failed at `at` failed
     *  for want of its computer, whatever version the home ran */
    downAfter(c: StoredCloud, at: number): boolean {
      const first = (c.managed?.computer?.history ?? []).find(([checkedAt]) => checkedAt >= at);
      return first?.[1] === true;
    },
    state: (c: StoredCloud) => c.managed?.computer ?? null,
  };
}
export type ComputerHealthChecks = ReturnType<typeof createComputerHealth>;
