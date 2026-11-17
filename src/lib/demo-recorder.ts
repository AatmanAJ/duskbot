import { useEffect, useSyncExternalStore } from "react";

import type { DemoPlan, DemoRecording, DemoReplayRun, DemoSurface } from "../../shared/demo-recording";
import { api } from "@/state/api";

export interface DemoSurfaces {
  browser: boolean;
  computer: boolean;
}

/** What the app knows of the tasks shown to one bot. */
export interface BotDemos {
  loaded: boolean;
  recordings: DemoRecording[];
  /** The latest replay of each recording, by recording id. */
  runs: Record<string, DemoReplayRun>;
  surfaces: DemoSurfaces;
}

const EMPTY: BotDemos = { loaded: false, recordings: [], runs: {}, surfaces: { browser: false, computer: false } };

// kept out of the app store: a recording changes with every click the person shows, and only its own panel draws it
const bots = new Map<string, BotDemos>();
const listeners = new Set<() => void>();

function update(botId: string, change: (demos: BotDemos) => BotDemos): void {
  bots.set(botId, change(bots.get(botId) ?? EMPTY));
  for (const listener of listeners) listener();
}

const newestFirst = (recordings: DemoRecording[]) => [...recordings].sort((a, b) => b.createdAt - a.createdAt);
const isRecording = (value: unknown): value is DemoRecording => typeof value === "object" && value !== null && typeof (value as DemoRecording).id === "string" && typeof (value as DemoRecording).botId === "string";
const isRun = (value: unknown): value is DemoReplayRun => typeof value === "object" && value !== null && typeof (value as DemoReplayRun).recordingId === "string" && Array.isArray((value as DemoReplayRun).items);

function keep(recording: DemoRecording): void {
  update(recording.botId, (demos) => ({ ...demos, recordings: newestFirst([recording, ...demos.recordings.filter((each) => each.id !== recording.id)]) }));
}

function keepRun(botId: string, run: DemoReplayRun): void {
  update(botId, (demos) => ({ ...demos, runs: { ...demos.runs, [run.recordingId]: run } }));
}

function forget(botId: string, id: string): void {
  update(botId, (demos) => {
    const { [id]: _gone, ...runs } = demos.runs;
    return { ...demos, recordings: demos.recordings.filter((each) => each.id !== id), runs };
  });
}

/** A `demo` frame from the server. */
export function publishDemoChange(frame: { botId?: unknown; recording?: unknown; run?: unknown; removed?: unknown }): void {
  const { botId, recording, run, removed } = frame;
  if (typeof botId !== "string") return;
  if (isRecording(recording) && recording.botId === botId) keep(recording);
  if (isRun(run)) keepRun(botId, run);
  if (typeof removed === "string") forget(botId, removed);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** The tasks shown to a bot, read once when a panel first asks and kept current by the server's frames. */
export function useBotDemos(botId: string): BotDemos {
  const demos = useSyncExternalStore(subscribe, () => bots.get(botId) ?? EMPTY, () => EMPTY);
  useEffect(() => {
    let active = true;
    void api<{ recordings: DemoRecording[]; surfaces: DemoSurfaces }>(`/api/bots/${botId}/demos`).then((answer) => {
      if (!active) return;
      update(botId, (now) => ({ ...now, loaded: true, recordings: newestFirst(answer.recordings), surfaces: answer.surfaces }));
    }).catch(() => {
      if (active) update(botId, (now) => ({ ...now, loaded: true }));
    });
    return () => { active = false; };
  }, [botId]);
  return demos;
}

const json = (method: string, body?: unknown): RequestInit => ({ method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

async function recordingFrom(path: string, init: RequestInit): Promise<DemoRecording> {
  const { recording } = await api<{ recording: DemoRecording }>(path, init);
  keep(recording);
  return recording;
}

export const demos = {
  start: (botId: string, surface: DemoSurface, threadId?: string) => recordingFrom(`/api/bots/${botId}/demos`, json("POST", { surface, ...(threadId ? { threadId } : {}) })),
  stop: (botId: string) => recordingFrom(`/api/bots/${botId}/demos/stop`, json("POST")),
  cancel: (botId: string) => api(`/api/bots/${botId}/demos/cancel`, json("POST")),
  savePlan: (id: string, plan: DemoPlan) => recordingFrom(`/api/demos/${id}/plan`, json("PUT", { plan })),
  saveSkill: (id: string, name: string) => recordingFrom(`/api/demos/${id}/skill`, json("POST", name.trim() ? { name: name.trim() } : {})),
  saveRoutine: (id: string, name: string, source: string) => recordingFrom(`/api/demos/${id}/routine`, json("POST", { source, ...(name.trim() ? { name: name.trim() } : {}) })),
  async remove(recording: DemoRecording) {
    await api(`/api/demos/${recording.id}`, json("DELETE"));
    forget(recording.botId, recording.id);
  },
  async replay(recording: DemoRecording, files: Array<{ name: string; content: string }>) {
    const { run } = await api<{ run: DemoReplayRun }>(`/api/demos/${recording.id}/replay`, json("POST", { files }));
    keepRun(recording.botId, run);
    return run;
  },
  stopReplay: (id: string) => api(`/api/demos/${id}/replay/stop`, json("POST")),
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
