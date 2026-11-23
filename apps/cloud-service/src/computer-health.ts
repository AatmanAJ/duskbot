// A running home's bot computers need docker and the docker gate in front of it. Either can stop answering while the
// machine keeps running (a docker restart the gate did not follow, a gate wedged on an older package's code), and
// nothing on the machine brings it back before a reboot. The reconciler checks after every wake and every
// COMPUTER_CHECK_MS while a home runs, with a command that repairs what it finds (home.ts COMPUTER_CHECK_SCRIPT). The
// operator hears once per incident; the update guard reads the history so a release is not blamed for runs that failed
// because the computer was down.
import type { StoredCloud } from "../../dashboard/server/clouds/types.ts";
import type { Audit, AuditEntry } from "./audit.ts";
import type { MachineImage, MachineProvider } from "./provider.ts";

export const COMPUTER_CHECK_MS = 10 * 60_000;
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
  /** an open incident (docker or the gate found not answering), closed by the next clean check */
  incident: { since: number; what: string } | null;
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

  function record(c: StoredCloud, why: string, check: ComputerCheck) {
    const s = stateOf(c);
    s.last = check;
    if (check.health !== "unknown") s.history = [...s.history, [check.at, check.infra] as [number, boolean]].slice(-HISTORY);
    const what = check.down ? `down_${check.down}` : check.fixed.filter(f => f === "docker" || f === "gate").join("_");
    if (check.health === "healed") log(c, "computer_healed", why, { fixed: check.fixed.join(":") });
    if (check.infra) {
      const opened = !s.incident;
      if (check.down && (opened || s.incident!.what !== what)) log(c, "computer_down", why, { what: check.down });
      if (opened) {
        const text = check.down
          ? `cloud ${c.id}: its bot computers cannot be reached: ${check.down === "docker" ? "docker" : "the docker gate"} did not come back after a restart`
          : `cloud ${c.id}: its bot computers were not answering (${what.replaceAll("_", " and ")} restarted); they answer again`;
        console.warn(`managed: ALERT ${text}`);
        deps.alert?.({ at: check.at, cloudId: c.id, action: "computer_down", actor: "reconciler", reason: text.slice(0, 900) });
      }
      s.incident = { since: s.incident?.since ?? check.at, what };
    } else if (s.incident && check.health !== "unknown") {
      log(c, "computer_ok", "recovered", { since: s.incident.since, was: s.incident.what });
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
    /** checks and repairs the home's docker and gate, unless a check ran at or after `notBefore` (default: now); never throws */
    async check(c: StoredCloud, why: string, notBefore = deps.now()): Promise<ComputerCheck | null> {
      if (!c.serverId || !c.managed) return null;
      const s = stateOf(c);
      if (s.last && s.last.health !== "unknown" && s.last.at >= notBefore) return s.last;
      let stdout: string;
      try {
        const done = await deps.provider.run(c.serverId, deps.image.computerCheckCommand, 240);
        stdout = done.stdout;
      } catch (error) {
        console.warn(`managed: the computer check of ${c.id} could not run: ${(error as Error).message}`);
        return null;
      }
      const check = parseComputerCheck(stdout, deps.now());
      record(c, why, check);
      return check;
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
