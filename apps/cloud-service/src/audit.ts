// Every lifecycle action on a managed home, one JSON line each, appended and never rewritten: who asked, why, when. A deletion
// also goes to the alert hook (recorded, never emailed). Lines carry ids and fixed codes only, never a secret, a token or an email address.
import { appendFileSync, closeSync, existsSync, openSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { stateBackend } from "../../dashboard/server/persistence/backend.ts";

export type AuditActor = "reconciler" | "owner" | "billing" | "operator" | "edge" | "system";
export interface AuditEntry { at: number; cloudId: string; action: string; actor: AuditActor; reason: string; serverId?: string | null; detail?: Record<string, string | number | boolean | null> }

const SAFE = /^[A-Za-z0-9_.:-]{0,120}$/;

export function createAudit(options: { dataDir: string; now?: () => number; alert?: (entry: AuditEntry) => void }) {
  const path = join(options.dataDir, "managed-audit.jsonl"), now = options.now ?? Date.now, backend = stateBackend();
  const written: AuditEntry[] = [];
  if (!backend && !existsSync(path)) closeSync(openSync(path, "a", 0o600));
  return {
    record(entry: Omit<AuditEntry, "at">): AuditEntry {
      // never throws: an audit line must not undo the lifecycle step it records; anything outside the safe set is masked
      const clean = (value: string) => SAFE.test(value) ? value : value.slice(0, 120).replace(/[^A-Za-z0-9_.:-]/g, "_");
      const detail = entry.detail ? Object.fromEntries(Object.entries(entry.detail).map(([k, v]) => [clean(k), typeof v === "string" ? clean(v) : v])) : undefined;
      const line: AuditEntry = { at: now(), ...entry, action: clean(entry.action), reason: clean(entry.reason), serverId: entry.serverId == null ? entry.serverId : clean(entry.serverId), ...(detail ? { detail } : {}) };
      if (backend) { backend.append("managed_audit", line); written.push(line); if (written.length > 1000) written.shift(); }
      else appendFileSync(path, `${JSON.stringify(line)}\n`, { mode: 0o600 });
      // a deletion step is routine lifecycle: a plain log line (never an incident or an email) and the alert hook, which only
      // records it; the operator reads deletions in admin and the daily digest
      if (/^delete|deleted$/.test(entry.action)) {
        console.log(`managed: ${line.action} cloud ${line.cloudId} by ${line.actor} (${line.reason})`);
        try { options.alert?.(line); } catch { console.log("managed: a deletion hook threw"); }
      }
      return line;
    },
    /** with a database backend: this process's latest 1000 lines (the full log is the managed_audit collection) */
    entries(cloudId?: string): AuditEntry[] {
      if (backend) return written.filter(e => cloudId === undefined || e.cloudId === cloudId);
      if (!existsSync(path)) return [];
      return readFileSync(path, "utf8").split("\n").filter(Boolean).map(line => JSON.parse(line) as AuditEntry).filter(e => cloudId === undefined || e.cloudId === cloudId);
    },
  };
}
export type Audit = ReturnType<typeof createAudit>;

/**
 * the alert hook's outage pair: "outage_open" is the operator's one "something's wrong" email for a problem the backend
 * could not fix by itself, "outage_close" its one "back to normal"; `key` names that one outage, `title` is the subject
 */
export const outageEntry = (open: boolean, at: number, cloudId: string, key: string, title: string, text: string): AuditEntry =>
  ({ at, cloudId, action: open ? "outage_open" : "outage_close", actor: "reconciler", reason: text.slice(0, 900), detail: { key, title: title.slice(0, 60) } });
