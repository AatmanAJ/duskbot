/**
 * The live stream's frame protocol, asked for with `?protocol=` on /api/events.
 * 1 (no parameter): every bot change is a whole `bot` frame with every thread.
 * 2: a bot the stream already sent changes by a `bot.patch` or `task.patch` (shared/live-patch.ts); whole frames still
 *    carry new bots, bots whose open thread changed, and the first frame of every bot after a snapshot read.
 * A server that knows only 1 ignores the parameter, and a client that asks for nothing gets 1.
 */
export const LIVE_PROTOCOL = 2;
export const LIVE_PROTOCOL_PARAM = "protocol";

/** The query parameters a client of this build opens its stream with. */
export function liveEventsParams(): Record<string, string> {
  return { [LIVE_PROTOCOL_PARAM]: String(LIVE_PROTOCOL) };
}

/** The protocol a stream asked for; anything this server does not know is 1. */
export function liveProtocolOf(value: string | null | undefined): 1 | 2 {
  return value === "2" ? 2 : 1;
}
