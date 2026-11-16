import { diffBotFrames, PAGE_KEYS, patchBase, type LivePatchFrame, type PatchableBot } from "../shared/live-patch.ts";

/** What protocol 2 streams get for one bot frame: a patch, nothing (the bot did not change), or the whole frame. */
export type BotFrameDelivery = { patch: LivePatchFrame } | { unchanged: true } | { whole: true };

/**
 * Each bot's revision and the bot its last frame carried, so the next frame can go out as a patch. A bot's revision
 * moves only when its frame changes something; a snapshot read makes every bot's next frame whole, so a client that
 * just read its bots never patches what it read.
 */
export class BotFrameLog {
  private readonly revs = new Map<string, number>();
  private sent = new Map<string, PatchableBot>();

  rev(id: string): number {
    return this.revs.get(id) ?? 0;
  }

  /** `bot` stamped with the revision it goes out as, and what protocol 2 streams get instead of it. */
  next<Bot extends PatchableBot>(bot: Bot): { bot: Bot & { rev: number }; delivery: BotFrameDelivery } {
    const base = this.rev(bot.id);
    const previous = this.sent.get(bot.id);
    const page = PAGE_KEYS.some((key) => bot[key] !== undefined);
    if (previous && !page) {
      const unchanged = diffBotFrames(previous, { ...bot, rev: base }, base, base + 1);
      if (!unchanged) return { bot: { ...bot, rev: base }, delivery: { unchanged: true } };
      this.revs.set(bot.id, base + 1);
      const stamped = { ...bot, rev: base + 1 };
      this.sent.set(bot.id, patchBase(stamped));
      return { bot: stamped, delivery: { patch: unchanged } };
    }
    this.revs.set(bot.id, base + 1);
    const stamped = { ...bot, rev: base + 1 };
    this.sent.set(bot.id, patchBase(stamped));
    return { bot: stamped, delivery: { whole: true } };
  }

  /** After a snapshot read: the next frame of every bot goes out whole. */
  resync(): void {
    this.sent = new Map();
  }

  /** A deleted bot's last frame; its revision stays, so a bot restored under the same id never reuses one. */
  forget(id: string): void {
    this.sent.delete(id);
  }
}

/** A frame's bot that can be diffed: an object with an id. */
export function isPatchableBot(value: unknown): value is PatchableBot {
  return typeof value === "object" && value !== null && typeof (value as { id?: unknown }).id === "string";
}
