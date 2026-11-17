// A notice's sound, end to end: the real server and Claude driver, the fake engine calling set_notification_sound the way
// Claude Code reports an MCP call, and the `notify` frame every client plays (or does not play) a sound for.
import { afterEach, expect, it } from "vitest";

import { launchVerificationServer, runControlDusk, type VerificationServer } from "../scripts/control-dusk.ts";
import type { Notification } from "../shared/notification.ts";
import { openSse, type SseRecorder } from "./testing/sse.ts";

let fixture: VerificationServer | undefined;
let events: SseRecorder | undefined;
afterEach(async () => {
  events?.close();
  if (fixture) {
    console.info(JSON.stringify({ logPath: fixture.info.logPath }));
    await fixture.close();
  }
  fixture = events = undefined;
});

const soundCall = (sound: "quiet" | "ding") => ({ tool: { name: "mcp__agents__set_notification_sound", input: { sound } } });

async function server(script?: unknown[]) {
  fixture = await launchVerificationServer({ ...process.env, ...(script ? { FAKE_CLAUDE_SCRIPT: JSON.stringify(script) } : {}) });
  const { url } = fixture.info;
  const api = async (method: string, path: string, body?: unknown) => {
    const response = await fetch(`${url}${path}`, {
      method, headers: { "content-type": "application/json", origin: url },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const value = await response.json() as any;
    expect(response.status, `${method} ${path}: ${JSON.stringify(value)}`).toBeLessThan(300);
    return value;
  };
  const cli = (...args: string[]) => runControlDusk([...args, "--url", url]) as Promise<any>;
  const { bot } = await cli("new-bot", "--name", "Nova");
  const main = bot.activeTaskId as string;
  events = await openSse(`${url}/api/events`, { origin: url });
  const notices = () => events!.frames.filter((frame) => frame.kind === "notify").map((frame) => frame.notification as Notification & { id: string });
  const done = async () => {
    await expect.poll(() => notices().filter((notice) => notice.kind === "done").length, { timeout: 30_000 }).toBeGreaterThan(0);
    return notices().filter((notice) => notice.kind === "done").at(-1)!;
  };
  const ask = async (text: string) => {
    await cli("send", "--bot", bot.id, "--task", main, "--text", text);
    await cli("wait", "--bot", bot.id, "--task", main, "--timeout", "30");
    return done();
  };
  const runRoutine = async (name: string) => {
    const { routine } = await api("POST", "/api/routines", {
      name, prompt: `Do the ${name} check.`, botId: bot.id, enabled: false,
      schedule: { type: "interval", everyMinutes: 60, anchorAt: Date.now() + 3_600_000 },
    });
    const { run } = await api("POST", `/api/routines/${routine.id}/run`);
    await expect.poll(async () => (await api("GET", "/api/routines")).runs.find((candidate: any) => candidate.id === run.id)?.status, { timeout: 30_000 }).toBe("completed");
    return done();
  };
  const feed = async () => (await api("GET", "/api/notifications")).notifications as Array<Notification & { id: string; read: boolean }>;
  return { api, bot, main, ask, runRoutine, feed };
}

it("by default a reply to the person dings and a routine's receipt goes quietly, still in the feed as unread", async () => {
  const s = await server();
  const reply = await s.ask("What's on today?");
  expect(reply.silent).toBeUndefined();

  const receipt = await s.runRoutine("Overnight backup");
  expect(receipt).toMatchObject({ kind: "done", botId: s.bot.id, silent: true });
  expect((await s.feed()).find((entry) => entry.id === receipt.id)).toMatchObject({ kind: "done", read: false });
}, 120_000);

it("a bot's quiet call silences its reply's notice to the person", async () => {
  const s = await server([soundCall("quiet"), { text: "Filed the receipt." }]);
  const quiet = await s.ask("File this receipt.");
  expect(quiet).toMatchObject({ kind: "done", silent: true, body: expect.stringContaining("Filed the receipt.") });
}, 120_000);

it("a routine that calls ding for a result the person asked for rings, against the routine default", async () => {
  const s = await server([soundCall("ding"), { text: "The flight price dropped to $212: book now?" }]);
  const loud = await s.runRoutine("Flight watch");
  expect(loud.kind).toBe("done");
  expect(loud.silent).toBeUndefined();
}, 120_000);
