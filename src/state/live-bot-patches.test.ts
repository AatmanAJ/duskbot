import { describe, expect, it, vi } from "vitest";

import { diffBotFrames, type PatchableBot } from "../../shared/live-patch";
import { createLiveBotPatches } from "./live-bot-patches";

type Bot = PatchableBot & { tasks: Array<{ threadId: string; title: string }> };
const bot = (rev: number, title = "One"): Bot => ({ id: "b", rev, name: "Nova", threadId: "t1", tasks: [{ threadId: "t1", title }, { threadId: "t2", title: "Two" }] });

describe("createLiveBotPatches", () => {
  it("applies a patch to the bot its stream last sent, keeping the threads it left alone", () => {
    const resync = vi.fn();
    const patches = createLiveBotPatches({ current: () => undefined, resync });
    const sent = bot(4);
    patches.whole(sent);
    const next = patches.patch(diffBotFrames(sent, bot(5, "Renamed"), 4, 5)!)!;
    expect(next.tasks![0]).toEqual({ threadId: "t1", title: "Renamed" });
    expect(next.tasks![1]).toBe(sent.tasks![1]);
    expect(resync).not.toHaveBeenCalled();
  });

  it("applies to the store's copy after a snapshot, and never to a page the store keeps", () => {
    const stored = { ...bot(7), messages: [{ id: "m" }], hasMore: true };
    const patches = createLiveBotPatches<PatchableBot>({ current: () => stored, resync: vi.fn() });
    patches.whole(bot(2));
    patches.reset();
    const next = patches.patch(diffBotFrames(bot(7), bot(8, "Later"), 7, 8)!)!;
    expect(next).not.toHaveProperty("messages");
    expect(next.rev).toBe(8);
  });

  it("ignores a patch the store already has, and reads the bot again after a gap", () => {
    const resync = vi.fn();
    const patches = createLiveBotPatches({ current: () => bot(9), resync });
    expect(patches.patch(diffBotFrames(bot(5), bot(6, "Old"), 5, 6)!)).toBeNull();
    expect(resync).not.toHaveBeenCalled();
    expect(patches.patch(diffBotFrames(bot(11), bot(12, "New"), 11, 12)!)).toBeNull();
    expect(resync).toHaveBeenCalledWith("b");
  });
});
