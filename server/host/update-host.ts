// The server's update state (server/update-state.ts) with its self-test wired to this server: its store reads, a page in
// the bot's browser when it has one, and one cheap read per connected Google app (the Gmail address, the next minute of
// the calendar). Runs are the routines' finished runs.
import { createConnectedReads, READ_APPS, type ConnectedReadDeps, type ReadApp } from "../connected-reads.ts";
import { createUpdateState, type FinishedRun } from "../update-state.ts";
import { browserPageCheck } from "../update-selftest.ts";
import { COMPUTER_UNREACHABLE, isRawComputerTransportError } from "../../shared/computer-unreachable.ts";

const computerUnreachable = (error: string | undefined) => !!error && (error.includes(COMPUTER_UNREACHABLE) || isRawComputerTransportError(error));

export interface UpdateHostDeps {
  dataDir: string;
  version: string;
  health(): boolean;
  /** the bot's browser binary, or null when this install has none (or the built-in browser is off) */
  browser(): Promise<string | null>;
  /** which Google apps are connected (null: connected apps are not set up) and the relay their reads go through */
  connected(): Promise<Record<ReadApp, boolean> | null>;
  relay: ConnectedReadDeps["relay"];
  runs(): ReadonlyArray<{ id: string; status: string; finishedAt?: number; error?: string }>;
  log(line: string): void;
}

export function createUpdateHost(deps: UpdateHostDeps) {
  const reads = createConnectedReads({ connected: deps.connected, relay: deps.relay });
  return createUpdateState({
    dataDir: deps.dataDir, version: deps.version, log: deps.log,
    checks: {
      health: deps.health,
      browser: browserPageCheck(deps.browser, { args: process.getuid?.() === 0 ? ["--no-sandbox"] : [] }),
      async connectors() {
        const connected = await deps.connected();
        if (!connected) return {};
        const apps = READ_APPS.filter(app => connected[app]);
        const session = reads.session(), from = Date.now();
        const answers = await Promise.all(apps.map(app => (app === "gmail" ? session.address() : session.events(from, from + 60_000)).then(() => true, () => false)));
        return Object.fromEntries(apps.map((app, i) => [app, answers[i]!]));
      },
    },
    runs: (since): FinishedRun[] => deps.runs()
      .filter(r => (r.status === "completed" || r.status === "failed") && (r.finishedAt ?? 0) >= since)
      .map(r => ({ id: r.id, ok: r.status === "completed", at: r.finishedAt!, ...(r.status === "failed" && computerUnreachable(r.error) ? { infra: true as const } : {}) }))
      .sort((a, b) => a.at - b.at),
  });
}
