import { describe, expect, it } from "vitest";

import type { Bot, Message } from "@/state/store";
import type { TurnLive } from "@/state/turn-status";
import { turnActivityStart } from "../../shared/phone-activity";
import { localTurnActivity, sameTurnActivity } from "./turn-activity";

const user = (id: string, text: string): Message => ({ id, role: "user", kind: "text", text } as Message);
const tool = (id: string): Message => ({ id, role: "bot", kind: "activity", tool: { name: "web_search" } } as Message);
const reply = (id: string, text: string): Message => ({ id, role: "bot", kind: "text", text } as Message);
const ask = (id: string, requestId: string, requestType: "permission" | "question", answered?: string): Message =>
  ({ id, role: "bot", kind: "options", card: { title: "", subtitle: "", options: [], requestId, requestType, ...(answered ? { answered } : {}) } } as unknown as Message);
const bot = (messages: Message[], activity: Bot["activity"], busy = activity !== "idle"): Bot => ({ id: "b1", threadId: "t1", messages, activity, busy } as Bot);
const live = (status: TurnLive["status"], ended = false): TurnLive => ({ status, ended });

const start = turnActivityStart(1000);

describe("the open app's turn activity", () => {
  it("counts this turn's steps and shows the running one", () => {
    const now = localTurnActivity(start, bot([tool("old"), user("u1", "go"), tool("a"), tool("b")], "working"), live({ activity: "web" }));
    expect(now).toEqual({ phase: "working", step: "web", steps: 2, startedAt: 1000 });
    expect(localTurnActivity({ ...start, steps: 5 }, bot([user("u1", "go"), tool("a")], "working"), live(null)).steps).toBe(5);
  });

  it("waits on the person with the open ask's kind and id", () => {
    expect(localTurnActivity(start, bot([user("u1", "go"), ask("c1", "r1", "permission")], "waiting-on-you"), live(null)))
      .toEqual({ phase: "needs-you", steps: 0, startedAt: 1000, ask: { kind: "approve", requestId: "r1" } });
    expect(localTurnActivity(start, bot([user("u1", "go"), ask("c1", "r1", "question"), ask("c2", "r2", "question", "Yes")], "waiting-on-you"), live(null)).ask)
      .toEqual({ kind: "answer", requestId: "r1" });
  });

  it("ends done with the reply's first line once the bot stops", () => {
    expect(localTurnActivity(start, bot([user("u1", "go"), tool("a"), reply("r", "## All set\nMore")], "idle"), live(null, true)))
      .toEqual({ phase: "done", steps: 1, startedAt: 1000, line: "All set" });
  });

  it("keeps a finished activity as it was", () => {
    const done = { ...start, phase: "done" as const };
    expect(localTurnActivity(done, bot([], "working"), live({ activity: "web" }))).toBe(done);
  });

  it("compares what the lock screen shows", () => {
    expect(sameTurnActivity(start, { ...start })).toBe(true);
    expect(sameTurnActivity(start, { ...start, step: "web" })).toBe(false);
  });
});
