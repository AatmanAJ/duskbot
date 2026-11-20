// The phone's view of the account's computers (ACCOUNT_ROUTES.appComputers) and the pairing it asks one of them for
// (appComputerPair): the service queues a phone.pair command on the computer's own line and hands the link it answers
// with straight to the waiting phone. The link carries a one-time grant secret, so it is never stored or logged here.
import { COMPUTER_ASLEEP_MS, type AppComputer, type AppComputerPairAnswer, type ComputerPresence } from "../../../shared/account-api.ts";
import { APP_COMMAND_ONLINE_MS } from "../../../shared/dashboard-protocol.ts";
import { MOBILE_GRANT_TTL_MS, parseMobileLink } from "../../../shared/mobile-link.ts";
import type { StoredWorkspace } from "./store.ts";

/** how long the phone's request waits for the computer's answer; the phone's own timeout is 20 s plus its read */
export const COMPUTER_PAIR_WAIT_MS = 18_000;
/** pairings one account may ask for an hour, one address an hour, and at once per computer */
export const COMPUTER_PAIR_LIMITS = { perAccount: 30, perIp: 60, pendingPerComputer: 2 } as const;
export const COMPUTER_ID = /^ws_[A-Za-z0-9_-]{1,64}$/;

/** online while the computer holds its line to the service (it does every 25 s), asleep for a day after, then offline */
export function presenceOf(lastSeenAt: number | null, now: number): ComputerPresence {
  if (lastSeenAt === null) return "offline";
  const age = now - lastSeenAt;
  return age <= APP_COMMAND_ONLINE_MS ? "online" : age <= COMPUTER_ASLEEP_MS ? "asleep" : "offline";
}

export function appComputer(ws: StoredWorkspace, seenAt: number | undefined, now: number): AppComputer {
  const lastSeenAt = Math.max(seenAt ?? 0, ws.lastReportAt ?? 0) || null;
  return { id: ws.id, name: ws.name, kind: ws.kind, presence: presenceOf(lastSeenAt, now), lastSeenAt, environmentId: ws.report?.workspace.environmentId ?? null };
}

/** the computer's link as the phone gets it: a valid v2 pairing link whose grant is still live and no longer than a grant lives */
export function pairAnswer(link: string, now: number): AppComputerPairAnswer | null {
  const payload = parseMobileLink(link);
  if (!payload || payload.grant.expiresAt <= now || payload.grant.expiresAt > now + MOBILE_GRANT_TTL_MS + 60_000) return null;
  return { v: 1, link, expiresAt: payload.grant.expiresAt };
}
