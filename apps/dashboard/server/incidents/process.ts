import { fileSpool } from "../../../../electron/error-report-spool.mjs";
import type { Incidents } from "./index.ts";

/** the warnings kept on the health page; only an ALERT line among them, or a console.error line, emails the owner */
export const WARN_ALERT = /\bALERT\b|\bfail(s|ed|ing|ure)?\b/i;
/** a problem that went away by itself is its own record, never a new incident */
const RECOVERED = /\bworks again\b|\bhas room again\b/i;
const OWN = /^incidents:/;
/** node's own warning line, "(node:4028072) MaxListenersExceededWarning: ...", and the hint it prints after it */
const NODE_WARNING = /^\(node:\d+\) (?:\[[\w-]+\] )?([A-Z]\w{0,60}Warning): /;
const NODE_WARNING_HINT = /^\(Use `node --trace-warnings/;

function lineOf(args: unknown[]): { text: string; error: Error | null } {
  const error = args.find((arg): arg is Error => arg instanceof Error) ?? null;
  const text = args.map(arg => arg instanceof Error ? `${arg.name}: ${arg.message}` : typeof arg === "string" ? arg : (() => { try { return JSON.stringify(arg); } catch { return String(arg); } })()).join(" ");
  return { text, error };
}

/** console.error, and console.warn lines that name an ALERT or a failure, become incidents; the lines still print */
export function tapConsole(incidents: Pick<Incidents, "report">, target: Pick<Console, "error" | "warn"> = console) {
  let inside = false;
  const wrap = (level: "error" | "warn") => {
    const original = target[level].bind(target);
    target[level] = (...args: unknown[]) => {
      original(...args);
      if (inside) return;
      inside = true;
      try {
        const { text, error } = lineOf(args);
        if (NODE_WARNING_HINT.test(text)) return;
        const warning = NODE_WARNING.exec(text)?.[1];
        // one incident per kind of warning, for the daily email: a warning is not an outage
        if (warning) { incidents.report({ source: "log", name: warning, message: text.replace(NODE_WARNING, ""), key: `node-${warning}` }); return; }
        if (OWN.test(text) || (level === "warn" && (!WARN_ALERT.test(text) || RECOVERED.test(text)))) return;
        const prefix = /^([a-z][\w-]{1,20}):/.exec(text)?.[1] ?? "service";
        incidents.report({ source: "log", name: `${prefix} ${/\bALERT\b/.test(text) ? "alert" : level}`, message: text.replace(/^[a-z][\w-]{1,20}:\s*/, ""), stack: error?.stack?.split("\n").slice(1).join("\n") ?? null });
      } finally { inside = false; }
    };
    return original;
  };
  const restore = { error: wrap("error"), warn: wrap("warn") };
  return () => { target.error = restore.error; target.warn = restore.warn; };
}

/**
 * a crash cannot send an email before the process exits, so it is written to a spool synchronously and reported by the
 * next start (systemd restarts the service); the Oracle uptime check covers the minutes in between
 */
export function watchProcess(incidents: Pick<Incidents, "report" | "test">, options: { spoolPath: string; proc?: NodeJS.Process }) {
  const proc = options.proc ?? process, spool = fileSpool(options.spoolPath);
  let lines: string[] = [];
  try { lines = spool.take().slice(-20); } catch {}
  for (const line of lines) {
    try {
      const crash = JSON.parse(line) as { name?: string; message?: string; stack?: string; origin?: string; at?: number };
      incidents.report({ source: "process", name: crash.name, message: `${crash.origin === "unhandledRejection" ? "unhandled rejection" : "uncaught exception"}: ${crash.message ?? ""}`,
        stack: crash.stack ?? null, at: typeof crash.at === "number" ? crash.at : undefined });
    } catch {}
  }
  proc.on("uncaughtExceptionMonitor", (error: unknown, origin: string) => {
    const err = error instanceof Error ? error : new Error(String(error));
    try { spool.append(JSON.stringify({ name: err.name, message: err.message, stack: (err.stack ?? "").split("\n").slice(1, 31).join("\n"), origin, at: Date.now() })); } catch {}
  });
  proc.on("SIGUSR2", () => { void incidents.test("server"); });
  return lines.length;
}

/** state writes failing (MongoDB unreachable, or a lost majority) is checked every 30 seconds */
export function watchDatabase(incidents: Pick<Incidents, "report">, health: () => { ok: boolean; detail: string } | null, every = 30_000) {
  const timer = setInterval(() => {
    const state = health();
    if (state && !state.ok) incidents.report({ source: "database", name: "DatabaseWritesFailing", message: state.detail, key: "writes-failing" });
  }, every);
  timer.unref();
  return () => clearInterval(timer);
}
