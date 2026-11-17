import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, it } from "vitest";

import { launchVerificationServer } from "../scripts/control-dusk.ts";
import { hostTimeout } from "./testing/host-timeout.ts";
import { openSse } from "./testing/sse.ts";

type Task = { threadId: string; title?: string; busy?: boolean; activity?: string; pinned?: boolean; unread?: boolean };
type Bot = { id: string; name?: string; threadId: string; busy?: boolean; activity?: string; unread?: boolean; tasks?: Task[] };
type Frame = { kind: string; [key: string]: unknown };
type Applier = (bots: Bot[], frame: Frame) => Bot[];

const ROOT = join(import.meta.dirname, "..");

/** The query the desktop's stream opts in with, and the reducer it applies frames with, when this build has them. */
async function desktopProtocol(): Promise<{ query: string; apply: Applier }> {
  const protocolFile = join(ROOT, "shared", "live-protocol.ts");
  const params = existsSync(protocolFile)
    ? ((await import(pathToFileURL(protocolFile).href)) as { liveEventsParams?: () => Record<string, string> }).liveEventsParams?.() ?? {}
    : {};
  const patchFile = join(ROOT, "shared", "live-patch.ts");
  const shared = existsSync(patchFile) ? ((await import(pathToFileURL(patchFile).href)) as { applyLiveBotFrame?: Applier }).applyLiveBotFrame : undefined;
  const replace: Applier = (bots, frame) => {
    if (frame.kind === "bot") {
      const bot = frame.bot as Bot;
      return bots.some((candidate) => candidate.id === bot.id) ? bots.map((candidate) => candidate.id === bot.id ? bot : candidate) : [bot, ...bots];
    }
    if (frame.kind === "bot.deleted") return bots.filter((candidate) => candidate.id !== frame.botId);
    return bots;
  };
  return { query: new URLSearchParams({ screens: "off", ...params }).toString(), apply: shared ?? replace };
}

/** What every client must agree on, whichever frames carried it. */
const projection = (bots: Bot[]) => bots.map((bot) => ({
  id: bot.id, name: bot.name, threadId: bot.threadId, busy: Boolean(bot.busy), activity: bot.activity ?? "idle", unread: Boolean(bot.unread),
  tasks: (bot.tasks ?? []).map((task) => ({ threadId: task.threadId, title: task.title, busy: Boolean(task.busy), activity: task.activity ?? "idle", pinned: Boolean(task.pinned), unread: Boolean(task.unread) })),
})).sort((a, b) => a.id.localeCompare(b.id));

it("an older client keeps full bot frames, and the desktop's stream converges on the same bots", async () => {
  const session = await launchVerificationServer({ ...process.env });
  const url = session.info.url;
  const call = async (path: string, body?: unknown, method = body === undefined ? "GET" : "POST") => {
    const response = await fetch(`${url}${path}`, method === "GET" ? {} : { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    expect(response.ok, `${method} ${path}: ${response.status}`).toBe(true);
    return response.json() as Promise<any>;
  };
  const older = await openSse(`${url}/api/events?screens=off`);
  const desktop = await desktopProtocol();
  const current = await openSse(`${url}/api/events?${desktop.query}`);
  try {
    await older.until((frame) => frame.kind === "hello");
    await current.until((frame) => frame.kind === "hello");
    let state: Bot[] = (await call("/api/bots?messages=0")).bots;
    const seenUpTo = current.frames.length;
    const bot = state[0]!;
    const before = new Set((bot.tasks ?? []).map((task) => task.threadId));
    const created = (await call(`/api/bots/${bot.id}/tasks`, { title: "compat thread", select: false })).task as Task;
    await call(`/api/bots/${bot.id}/tasks/${created.threadId}`, { title: "compat renamed" }, "PATCH");
    await call(`/api/bots/${bot.id}/tasks/${created.threadId}`, { pinned: true }, "PATCH");
    await call(`/api/bots/${bot.id}/messages`, { threadId: created.threadId, text: "hello from the compat test" });
    await older.until((frame) => frame.kind === "runtime" && frame.event?.type === "turn.completed" && frame.event.threadId === created.threadId, hostTimeout(30_000));
    for (const deadline = Date.now() + hostTimeout(20_000); ; await new Promise((resolve) => setTimeout(resolve, 100))) {
      const now = (await call("/api/bots?messages=0")).bots as Bot[];
      if (now.every((candidate) => !candidate.busy && !candidate.tasks?.some((task) => task.busy))) break;
      expect(Date.now() < deadline, "the turn settles").toBe(true);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
    const truth = (await call("/api/bots?messages=0")).bots as Bot[];

    // the older client: whole bots on every change, every thread in each, never a frame kind it does not know
    expect(older.frames.some((frame) => frame.kind === "bot.patch" || frame.kind === "task.patch")).toBe(false);
    const fullFrames = older.frames.filter((frame) => frame.kind === "bot" && frame.bot.id === bot.id);
    expect(fullFrames.length).toBeGreaterThan(2);
    const last = fullFrames.at(-1)!.bot as Bot;
    const truthBot = truth.find((candidate) => candidate.id === bot.id)!;
    expect(new Set(last.tasks!.map((task) => task.threadId))).toEqual(new Set(truthBot.tasks!.map((task) => task.threadId)));
    expect([...before].every((threadId) => last.tasks!.some((task) => task.threadId === threadId))).toBe(true);
    expect(last.tasks!.find((task) => task.threadId === created.threadId)).toMatchObject({ title: "compat renamed", pinned: true });
    let olderState = (await call("/api/bots?messages=0")).bots as Bot[];
    for (const frame of fullFrames) olderState = olderState.map((candidate) => candidate.id === frame.bot.id ? frame.bot : candidate);
    expect(projection(olderState)).toEqual(projection(truth));

    // the desktop's stream, applied to its snapshot, ends where the server is
    for (const frame of current.frames.slice(seenUpTo)) state = desktop.apply(state, frame);
    expect(projection(state)).toEqual(projection(truth));
  } finally {
    older.close();
    current.close();
    await session.close();
  }
}, hostTimeout(120_000));
