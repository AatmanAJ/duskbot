import { expect, it } from "vitest";

import { applyBotPatch } from "../shared/live-patch.ts";
import { BotFrameLog } from "./live-bot-frames.ts";

const bot = (busy: boolean, extra: Record<string, unknown> = {}) => ({ id: "b", name: "Nova", busy, tasks: [{ threadId: "t", busy }], ...extra });

it("sends a bot whole first, then patches, skips frames that change nothing, and goes whole again after a snapshot", () => {
  const log = new BotFrameLog();
  const first = log.next(bot(false));
  expect(first).toMatchObject({ bot: { rev: 1 }, delivery: { whole: true } });
  const second = log.next(bot(true));
  expect(second.bot.rev).toBe(2);
  expect("patch" in second.delivery && applyBotPatch(first.bot, second.delivery.patch)).toEqual(second.bot);
  const same = log.next(bot(true));
  expect(same).toMatchObject({ bot: { rev: 2 }, delivery: { unchanged: true } });
  expect(log.next(bot(false, { messages: [], hasMore: false }))).toMatchObject({ bot: { rev: 3 }, delivery: { whole: true } });
  expect(log.next(bot(true)).delivery).toHaveProperty("patch");
  log.resync();
  expect(log.next(bot(false)).delivery).toEqual({ whole: true });
  log.forget("b");
  expect(log.next(bot(false))).toMatchObject({ bot: { rev: 6 }, delivery: { whole: true } });
  expect(log.rev("b")).toBe(6);
});
