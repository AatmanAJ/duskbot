import { applyBotPatch, patchBase, patchedBotId, type LivePatchFrame, type PatchableBot } from "../../shared/live-patch";

export interface LiveBotPatchesDeps<Bot extends PatchableBot> {
  /** The bot as the store holds it now, for a patch made from a revision no frame carried here (a snapshot read). */
  current: (botId: string) => Bot | undefined;
  /** Reads the bot again when a patch was made from a revision this client never had. */
  resync: (botId: string) => void;
}

/**
 * Turns protocol 2's patches back into the whole bots protocol 1 sends: a patch applies to the bot its stream last
 * carried, or to the store's copy when that copy is the revision the patch was made from (after a snapshot). Threads
 * the patch leaves alone stay the same objects, so what did not change keeps its identity in the store.
 */
export function createLiveBotPatches<Bot extends PatchableBot>(deps: LiveBotPatchesDeps<Bot>) {
  const held = new Map<string, Bot>();
  return {
    /** A whole bot, as the server sent it; what to show, without any page of messages it carried. */
    whole(bot: Bot): Bot {
      const base = patchBase(bot);
      held.set(bot.id, base);
      return base;
    },
    /** Whether `bot` (a read, not a frame) is newer than the bot the stream last sent. */
    newer(bot: Bot): boolean {
      const rev = held.get(bot.id)?.rev;
      return rev === undefined || typeof bot.rev !== "number" || bot.rev > rev;
    },
    deleted(botId: string): void {
      held.delete(botId);
    },
    /** A snapshot replaced the store's bots: they, not earlier frames, are what the next patches apply to. */
    reset(): void {
      held.clear();
    },
    /** The whole bot after `frame`, or null when there is nothing to show (a stale patch, or a re-read is on its way). */
    patch(frame: LivePatchFrame): Bot | null {
      const id = patchedBotId(frame);
      const bases = [held.get(id), deps.current(id)].filter((bot): bot is Bot => bot !== undefined);
      for (const base of bases) {
        if (base.rev !== frame.base) continue;
        const next = applyBotPatch(patchBase(base), frame);
        if (next) {
          held.set(id, next);
          return next;
        }
      }
      if (bases.some((bot) => typeof bot.rev === "number" && bot.rev >= frame.rev)) return null;
      held.delete(id);
      deps.resync(id);
      return null;
    },
  };
}
