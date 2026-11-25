import { canReach, reachRefusal, resolveTeammate, type RosterMember } from "./peer-roster.ts";

// Reading another bot's chats, read-only, for context: only a bot whose person turned "Can read other bots' chats" on,
// only on the person's own message in their one-on-one chat with it, and never on a dusk cloud, where other people's
// chats can share a bot. The reader never posts there: it gets the words, labelled as another bot's.

export interface CrossReadTurn {
  owned: boolean;
  room: boolean;
  guest: boolean;
  depth: number;
  handedOff: boolean;
  routineRun: boolean;
  outsideDriven: boolean;
  personStarted: boolean;
}

export const CROSS_READ_REFUSALS = {
  off: "Reading other bots' chats is off for you. The person can turn on \"Can read other bots' chats\" in your settings; until then, ask that bot with coordinate_bots consult true.",
  cloud: "Other bots' chats can't be read on dusk cloud, where they may hold other people's conversations. Ask that bot with coordinate_bots consult true.",
  turn: "Another bot's chats are read only for the person's own message in their one-on-one chat with you, never from a routine, a room, an outside event or work another bot handed you.",
  self: "That is you: leave bot out to search your own conversations.",
} as const;

export function crossReadRefusal(input: { enabled: boolean; cloudHome: boolean; turn: CrossReadTurn; self: boolean }): string | null {
  if (input.self) return CROSS_READ_REFUSALS.self;
  if (!input.enabled) return CROSS_READ_REFUSALS.off;
  if (input.cloudHome) return CROSS_READ_REFUSALS.cloud;
  const { turn } = input;
  if (!turn.owned || turn.room || turn.guest || turn.depth > 0 || turn.handedOff || turn.routineRun || turn.outsideDriven || !turn.personStarted) return CROSS_READ_REFUSALS.turn;
  return null;
}

/** The other bot's own one-on-one chats and threads: never a room, whose members and people the reader may not share. */
export function crossReadThreads(ownThreads: readonly string[], roomThreads: ReadonlySet<string>): string[] {
  return ownThreads.filter((id) => !roomThreads.has(id));
}

/** The bot a session_search `bot` names, with the chats this turn may read of it; null when it names none. */
export function crossReadTarget<T extends RosterMember & { readsOtherChats?: boolean }>(raw: string | null, from: T, deps: {
  bots: readonly T[]; bot(id: string): T | undefined; cloudHome: boolean; turn: CrossReadTurn;
  threads(bot: T): { ownThreads: string[]; roomByThread: ReadonlyMap<string, unknown> };
}): { bot: T; threads: string[] } | { status: number; error: string } | null {
  const wanted = raw?.trim();
  if (!wanted) return null;
  const found = resolveTeammate(deps.bots, from, wanted), target = "id" in found ? deps.bot(found.id) : undefined;
  const refusal = crossReadRefusal({ enabled: from.readsOtherChats === true, cloudHome: deps.cloudHome, self: target?.id === from.id || wanted === from.id || wanted.replace(/^@/, "").toLowerCase() === from.name.toLowerCase(), turn: deps.turn });
  if (refusal) return { status: 403, error: refusal };
  if (!target) return { status: 404, error: "error" in found ? found.error : "no such bot" };
  if (!canReach(from, target)) return { status: 403, error: reachRefusal(from, target) ?? "that bot cannot be reached" };
  const recall = deps.threads(target);
  return { bot: target, threads: crossReadThreads(recall.ownThreads, new Set(recall.roomByThread.keys())) };
}
