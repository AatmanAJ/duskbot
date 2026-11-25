import { useEffect, useState } from "react";
import { api } from "@/state/api";
import { setUsageAnalytics, usageSharingChanged, type SharingPlace } from "@/lib/product-analytics";

const ROUTE = "/api/dashboard/usage-signals";
const SHARED_ROUTE = "/api/dashboard/usage-shared";

/** The workspace's answers. `enabled`: usage counts and crash reports. `notes`: session notes, null until answered (no
 * notes), and only while `enabled` is on. `askUsage`: a region where usage counts wait for a yes, never answered.
 * `askNotes`: an account that has never been asked about session notes. */
export interface UsageSignals { enabled: boolean; notes: boolean | null; askUsage: boolean; askNotes?: boolean }
export type UsageSignalsPatch = Partial<{ enabled: boolean; notes: boolean }>;

export interface SharedNote { id: string; kind: "bad" | "big" | "weekly"; at: number; text: string | null }
export interface SharedCount { kind: "turns" | "runs" | "setup" | "events"; count: number; last: number; names?: string[] }
export interface UsageShared { notes: SharedNote[]; counts: SharedCount[]; removing: boolean }

export const readUsageSignals = () => api<UsageSignals>(ROUTE);
export const readUsageShared = () => api<UsageShared>(SHARED_ROUTE);
export const deleteUsageShared = () => api<{ ok: true; removing: boolean }>(SHARED_ROUTE, { method: "DELETE" });

function followEnabled(enabled: boolean, before: boolean | null, where: SharingPlace): void {
  if (before !== null && enabled !== before) usageSharingChanged(enabled, where);
  else setUsageAnalytics(enabled);
  void window.duskDesktop?.desktopAnalytics?.set?.(enabled)?.catch(() => {});
}

/** Saves an answer; the app's own analytics and the desktop's crash reports follow `enabled` when it was part of it. */
export async function saveUsageSignals(patch: UsageSignalsPatch, where: SharingPlace, enabledBefore: boolean | null): Promise<UsageSignals> {
  const answer = await api<UsageSignals>(ROUTE, { method: "PUT", body: JSON.stringify(patch) });
  if (patch.enabled !== undefined) followEnabled(answer.enabled, enabledBefore, where);
  return answer;
}

/** Settings' "help improve dusk bot" and "session notes" switches. `signals` is null until read; `failed` when reading
 * or saving did not work. */
export function useHelpImprove(where: SharingPlace) {
  const [signals, setSignals] = useState<UsageSignals | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    readUsageSignals().then((answer) => { if (live) setSignals(answer); }, () => { if (live) setFailed(true); });
    return () => { live = false; };
  }, []);
  const set = async (patch: UsageSignalsPatch) => {
    const before = signals;
    if (before) setSignals({ ...before, ...patch, ...(patch.enabled === true ? { askUsage: false } : {}) });
    setFailed(false);
    try {
      setSignals(await saveUsageSignals(patch, where, before?.enabled ?? null));
    } catch {
      setSignals(before);
      setFailed(true);
    }
  };
  return { signals, failed, set };
}

let lastSynced: boolean | null = null;
/** the account can turn the switch off (or on again) from its own page, and the server follows on its next report: the
 * app's own analytics and the desktop's crash reports follow the server's answer, now and every few minutes */
export async function syncHelpImprove(): Promise<void> {
  try {
    const answer = await readUsageSignals();
    if (typeof answer.enabled !== "boolean" || answer.enabled === lastSynced) return;
    lastSynced = answer.enabled;
    setUsageAnalytics(answer.enabled);
    void window.duskDesktop?.desktopAnalytics?.set?.(answer.enabled)?.catch(() => {});
  } catch {}
}
