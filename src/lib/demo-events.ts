import type { DemoRecording, DemoReplayRun } from "../../shared/demo-recording";

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

export const NO_DEMOS: BotDemos = { loaded: false, recordings: [], runs: {}, surfaces: { browser: false, computer: false } };

// kept out of the app store: a recording changes with every click the person shows, and only its own panel draws it
const bots = new Map<string, BotDemos>();
export const botDemos = (botId: string): BotDemos => bots.get(botId) ?? NO_DEMOS;
const listeners = new Set<() => void>();

export function updateBotDemos(botId: string, change: (demos: BotDemos) => BotDemos): void {
  bots.set(botId, change(bots.get(botId) ?? NO_DEMOS));
  for (const listener of listeners) listener();
}

const newestFirst = (recordings: DemoRecording[]) => [...recordings].sort((a, b) => b.createdAt - a.createdAt);
const isRecording = (value: unknown): value is DemoRecording => typeof value === "object" && value !== null && typeof (value as DemoRecording).id === "string" && typeof (value as DemoRecording).botId === "string";
const isRun = (value: unknown): value is DemoReplayRun => typeof value === "object" && value !== null && typeof (value as DemoReplayRun).recordingId === "string" && Array.isArray((value as DemoReplayRun).items);

export function keepDemoRecording(recording: DemoRecording): void {
  updateBotDemos(recording.botId, (demos) => ({ ...demos, recordings: newestFirst([recording, ...demos.recordings.filter((each) => each.id !== recording.id)]) }));
}

export function keepDemoRun(botId: string, run: DemoReplayRun): void {
  updateBotDemos(botId, (demos) => ({ ...demos, runs: { ...demos.runs, [run.recordingId]: run } }));
}

export function forgetDemoRecording(botId: string, id: string): void {
  updateBotDemos(botId, (demos) => {
    const { [id]: _gone, ...runs } = demos.runs;
    return { ...demos, recordings: demos.recordings.filter((each) => each.id !== id), runs };
  });
}

/** A `demo` frame from the server. */
export function publishDemoChange(frame: { botId?: unknown; recording?: unknown; run?: unknown; removed?: unknown }): void {
  const { botId, recording, run, removed } = frame;
  if (typeof botId !== "string") return;
  if (isRecording(recording) && recording.botId === botId) keepDemoRecording(recording);
  if (isRun(run)) keepDemoRun(botId, run);
  if (typeof removed === "string") forgetDemoRecording(botId, removed);
}

export function subscribeDemos(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
