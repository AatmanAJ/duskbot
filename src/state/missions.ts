import { useEffect, useSyncExternalStore } from "react";

import { MISSION_TITLE_MAX, type LaneDiff, type MissionSummary, type MissionView, type RepoProbe } from "../../shared/mission";
import { friendlyError } from "../lib/plain-error";
import { randomUuid } from "../lib/random-uuid";
import { api } from "./api";

function store<T>(initial: T) {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set(next: T) { value = next; for (const listener of listeners) listener(); },
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
}
const use = <T,>(s: ReturnType<typeof store<T>>): T => useSyncExternalStore(s.subscribe, s.get, s.get);

export interface MissionPage { open: boolean; missionId: string | null; composing: boolean }
const page = store<MissionPage>({ open: false, missionId: null, composing: false });
export const useMissionPage = (): MissionPage => use(page);
export const currentMissionPage = page.get;

export function openMissionControl(missionId?: string): void {
  const now = page.get();
  page.set({ open: true, missionId: missionId ?? now.missionId, composing: false });
  void refreshMissions();
}
export const closeMissionControl = (): void => { if (page.get().open) page.set({ ...page.get(), open: false, composing: false }); };
export const selectMission = (missionId: string): void => page.set({ ...page.get(), missionId, composing: false });
export const composeMission = (composing = true): void => page.set({ ...page.get(), composing });

const list = store<MissionSummary[] | null>(null);
const listFailed = store(false);
export const useMissionList = (): MissionSummary[] | null => use(list);
export const useMissionListFailed = (): boolean => use(listFailed);
export const setMissionList = list.set;

export async function refreshMissions(): Promise<void> {
  try {
    const { missions } = await api<{ missions: MissionSummary[] }>("/api/missions", { background: true });
    list.set(missions);
    listFailed.set(false);
    const shown = page.get();
    if (!shown.missionId && missions[0]) page.set({ ...shown, missionId: missions[0].id });
  } catch {
    listFailed.set(true);
  }
}

const views = store<Record<string, MissionView>>({});
export const setMissionView = (view: MissionView): void => views.set({ ...views.get(), [view.id]: view });
export function useMissionView(id: string | null): MissionView | null {
  const all = use(views);
  return id ? all[id] ?? null : null;
}

const HOLD_MS = 25_000;
const RETRY_MS = 4_000;

export function useMissionFollow(id: string | null): void {
  useEffect(() => {
    if (!id) return;
    let stopped = false;
    const controller = new AbortController();
    void (async () => {
      let version = "";
      while (!stopped) {
        try {
          const query = version ? `?wait=${HOLD_MS}&version=${encodeURIComponent(version)}` : "";
          const view = await api<MissionView>(`/api/missions/${id}${query}`, { background: true, signal: controller.signal, timeoutMs: HOLD_MS + 10_000 });
          if (stopped) return;
          if (view.version !== version) {
            setMissionView(view);
            const listed = list.get();
            if (listed) list.set(listed.map((one) => one.id === view.id ? summaryOf(view) : one));
          }
          version = view.version;
        } catch {
          if (stopped) return;
          await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
        }
      }
    })();
    return () => { stopped = true; controller.abort(); };
  }, [id]);
}

const summaryOf = ({ id, title, launchedAt, state, lanes, counts, finishedAt }: MissionView): MissionSummary =>
  ({ id, title, launchedAt, state, lanes, counts, ...(finishedAt !== undefined ? { finishedAt } : {}) });

export interface LaneDraft { botId: string; note?: string }
export interface MissionDraft { title: string; brief: string; lanes: LaneDraft[]; repo?: { root: string; head: string } }

export function laneBrief(brief: string, note?: string): string {
  const extra = note?.trim();
  return extra ? `${brief.trim()}\n\n${extra}` : brief.trim();
}

export interface LaunchResult { missionId: string; failed: Array<{ botId: string; error: string }> }

export async function launchMission(draft: MissionDraft): Promise<LaunchResult> {
  const missionId = `m-${randomUuid()}`;
  const title = draft.title.trim().slice(0, MISSION_TITLE_MAX);
  const launchedAt = Date.now() - 1_000;
  const failed: LaunchResult["failed"] = [];
  await Promise.all(draft.lanes.map(async (lane, index) => {
    try {
      const brief = laneBrief(draft.brief, lane.note);
      const made = await api<{ task: { threadId: string } }>(`/api/bots/${lane.botId}/tasks`, {
        method: "POST", body: JSON.stringify({ title, select: false, mission: {
          id: missionId, title, lane: index, launchedAt, brief, ...(draft.repo ? { worktree: { repo: draft.repo.root, base: draft.repo.head } } : {}),
        } }),
      });
      await sendToLane(lane.botId, made.task.threadId, brief);
    } catch (error) {
      failed.push({ botId: lane.botId, error: friendlyError(error) });
    }
  }));
  page.set({ open: true, missionId, composing: false });
  void refreshMissions();
  return { missionId, failed };
}

export function sendToLane(botId: string, threadId: string, text: string, followUp?: "steer" | "queue"): Promise<unknown> {
  return api(`/api/bots/${botId}/messages`, {
    method: "POST", body: JSON.stringify({ threadId, text, sendId: randomUuid(), ...(followUp ? { followUp } : {}) }),
  });
}

export function stopLane(botId: string, threadId: string): Promise<unknown> {
  return api(`/api/bots/${botId}/interrupt`, { method: "POST", body: JSON.stringify({ threadId }) });
}

export const probeRepo = (path: string): Promise<RepoProbe> => api<RepoProbe>(`/api/mission-repo?path=${encodeURIComponent(path)}`);

export const readLaneDiff = (missionId: string, threadId: string): Promise<LaneDiff> =>
  api<LaneDiff>(`/api/missions/${missionId}/lanes/${threadId}/diff`, { background: true });

export const removeLaneFolder = (missionId: string, threadId: string): Promise<{ ok: true; branch: string }> =>
  api(`/api/missions/${missionId}/lanes/${threadId}/worktree`, { method: "DELETE" });
