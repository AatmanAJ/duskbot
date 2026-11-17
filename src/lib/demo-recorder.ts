import { useEffect, useSyncExternalStore } from "react";

import type { DemoPlan, DemoRecording, DemoReplayItem, DemoReplayRun, DemoSurface } from "../../shared/demo-recording";
import { botDemos, forgetDemoRecording, keepDemoRecording, keepDemoRun, NO_DEMOS, subscribeDemos, updateBotDemos, type BotDemos, type DemoSurfaces } from "@/lib/demo-events";
import { api } from "@/state/store";

export type { BotDemos, DemoSurfaces } from "@/lib/demo-events";

/** The tasks shown to a bot, read once when a panel first asks and kept current by the server's frames. */
export function useBotDemos(botId: string): BotDemos {
  const demos = useSyncExternalStore(subscribeDemos, () => botDemos(botId), () => NO_DEMOS);
  useEffect(() => {
    let active = true;
    void api<{ recordings: DemoRecording[]; surfaces: DemoSurfaces }>(`/api/bots/${botId}/demos`).then((answer) => {
      if (!active) return;
      updateBotDemos(botId, (now) => ({ ...now, loaded: true, recordings: [...answer.recordings].sort((a, b) => b.createdAt - a.createdAt), surfaces: answer.surfaces }));
    }).catch(() => {
      if (active) updateBotDemos(botId, (now) => ({ ...now, loaded: true }));
    });
    return () => { active = false; };
  }, [botId]);
  return demos;
}

const json = (method: string, body?: unknown): RequestInit => ({ method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

async function recordingFrom(path: string, init: RequestInit): Promise<DemoRecording> {
  const { recording } = await api<{ recording: DemoRecording }>(path, init);
  keepDemoRecording(recording);
  return recording;
}

export const demos = {
  start: (botId: string, surface: DemoSurface, threadId?: string) => recordingFrom(`/api/bots/${botId}/demos`, json("POST", { surface, ...(threadId ? { threadId } : {}) })),
  stop: (botId: string) => recordingFrom(`/api/bots/${botId}/demos/stop`, json("POST")),
  cancel: (botId: string) => api(`/api/bots/${botId}/demos/cancel`, json("POST")),
  pause: (botId: string, paused: boolean) => recordingFrom(`/api/bots/${botId}/demos/pause`, json("POST", { paused })),
  undo: (botId: string) => recordingFrom(`/api/bots/${botId}/demos/undo`, json("POST")),
  savePlan: (id: string, plan: DemoPlan) => recordingFrom(`/api/demos/${id}/plan`, json("PUT", { plan })),
  saveSkill: (id: string, name: string) => recordingFrom(`/api/demos/${id}/skill`, json("POST", name.trim() ? { name: name.trim() } : {})),
  saveRoutine: (id: string, name: string, source: string) => recordingFrom(`/api/demos/${id}/routine`, json("POST", { source, ...(name.trim() ? { name: name.trim() } : {}) })),
  async remove(recording: DemoRecording) {
    await api(`/api/demos/${recording.id}`, json("DELETE"));
    forgetDemoRecording(recording.botId, recording.id);
  },
  async replay(recording: DemoRecording, files: Array<{ name: string; content: string }>) {
    const { run } = await api<{ run: DemoReplayRun }>(`/api/demos/${recording.id}/replay`, json("POST", { files }));
    keepDemoRun(recording.botId, run);
    return run;
  },
  /** The inputs as the files give them, to look over before anything is done. */
  inputs: async (id: string, files: Array<{ name: string; content: string }>) => (await api<{ items: DemoReplayItem[] }>(`/api/demos/${id}/inputs`, json("POST", { files }))).items,
  /** Does the task for inputs a person has looked over; a file that gets stuck waits to be skipped or tried again. */
  async replayItems(recording: DemoRecording, items: DemoReplayItem[]) {
    const { run } = await api<{ run: DemoReplayRun }>(`/api/demos/${recording.id}/replay`, json("POST", { items, ask: true }));
    keepDemoRun(recording.botId, run);
    return run;
  },
  decide: (id: string, decision: "skip" | "retry") => api(`/api/demos/${id}/replay/decide`, json("POST", { decision })),
  stopReplay: (id: string) => api(`/api/demos/${id}/replay/stop`, json("POST")),
  setSkill: (botId: string, skillName: string, enabled: boolean) => api(`/api/bots/${botId}/skills/${encodeURIComponent(skillName)}`, json("PATCH", { enabled })),
};

export const frameUrl = (recordingId: string, frameId: string) => `/api/demos/${recordingId}/frames/${frameId}`;

const TEXT_FILE = /\.(txt|csv|tsv|json|md|eml|log|xml|html?|ya?ml)$/i;
export const INPUT_FILES_MAX = 200;
const FILE_MAX_BYTES = 200_000;

/** The files a person picked, as text; ones that are not text or are too large to read are named in `skipped`. */
export async function readInputFiles(files: readonly File[]): Promise<{ read: Array<{ name: string; content: string }>; skipped: string[] }> {
  const read: Array<{ name: string; content: string }> = [];
  const skipped: string[] = [];
  for (const file of [...files].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })).slice(0, INPUT_FILES_MAX)) {
    if (file.size > FILE_MAX_BYTES || !(file.type.startsWith("text/") || file.type === "application/json" || TEXT_FILE.test(file.name))) {
      skipped.push(file.name);
      continue;
    }
    read.push({ name: file.name, content: await file.text() });
  }
  return { read, skipped };
}
