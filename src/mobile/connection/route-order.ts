import type { MobileTransport } from "../../../shared/mobile-link";

/** a computer's companion on the phone's own network answers well within this */
export const DIRECT_TRY_MS = 2_500;
/** past this, the companion routes left are skipped and the relay is tried */
export const DIRECT_BUDGET_MS = 6_000;

const relayed = (routes: readonly MobileTransport[]) => routes.some((route) => route.kind === "relay");

/** Android's web view cannot read a live stream from a computer's plain-http companion out of its https page (mixed
 * content), so there the relay carries the phone and the companion is the fallback. */
const relayFirst = (os: string | undefined, routes: readonly MobileTransport[]) => os === "android" && relayed(routes);

/** The order a phone tries a workspace's routes: where a relay is there too, a computer's wi-fi and tailnet addresses go
 * first, so the relay carries the phone only while no direct route answers (on Android the relay goes first). Otherwise
 * the order stays as given. */
export function routeOrder(routes: readonly MobileTransport[], os?: string): MobileTransport[] {
  if (!relayed(routes)) return [...routes];
  const direct = routes.filter((route) => route.kind === "companion"), rest = routes.filter((route) => route.kind !== "companion");
  return relayFirst(os, routes) ? [...rest, ...direct] : [...direct, ...rest];
}

/** how long one route gets: a companion ahead of a relay only briefly, everything else `fullMs` */
export function routeTimeout(route: MobileTransport, routes: readonly MobileTransport[], fullMs: number, os?: string): number {
  return route.kind === "companion" && relayed(routes) && !relayFirst(os, routes) ? DIRECT_TRY_MS : fullMs;
}

/** a companion route is still worth trying: the walk has not spent its direct budget yet, or no relay waits behind it */
export function directStillWorthIt(route: MobileTransport, routes: readonly MobileTransport[], startedAt: number, now = Date.now(), os?: string): boolean {
  return route.kind !== "companion" || !relayed(routes) || relayFirst(os, routes) || now - startedAt < DIRECT_BUDGET_MS;
}
