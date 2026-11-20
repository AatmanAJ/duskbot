// The digests the admin's views read (rollup.ts): each one folds events exactly as its view does, so a view computed from
// merged digests equals the same view computed from the raw events.
import { EVENTS } from "./events.ts";
import { pack, unpack, type Digest } from "./rollup.ts";
import { DAY, VISIT_EVENTS, addToSessions, isActive, mergeSessions, type Session, type Sessions } from "./web.ts";
import { UPSELL_EVENTS } from "../../../../shared/cloud-upsell.ts";
import { productDigest } from "../admin/product.ts";

const at = <K, V>(map: Map<K, V>, key: K, make: () => V) => map.get(key) ?? map.set(key, make()).get(key)!;
const earliest = (a: number | null, b: number | null) => a === null ? b : b === null ? a : Math.min(a, b);
/** adds `later`'s counts to `into`, new keys after the ones `into` has: the order they were first seen in */
function addCounts(into: Map<string, number>, later: Map<string, number>) { for (const [key, n] of later) into.set(key, (into.get(key) ?? 0) + n); }
function addSets<T>(into: Set<T>, later: Set<T>) { for (const item of later) into.add(item); }

/** every visit's state on every surface (visitsOf) */
export const visitsDigest: Digest<Sessions> = {
  kind: "visits", version: 1, names: VISIT_EVENTS,
  empty: () => new Map(),
  add: addToSessions,
  merge: mergeSessions,
  encode: sessions => [...sessions].map(([key, s]) => [key, s.session, s.visitor, s.surface, s.start, s.end, s.host, s.keyword, s.pages.map(page => [page.path, page.at, page.pv]),
    s.goals.map(goal => [goal.goal, goal.at, goal.to]), [...s.leaves].map(([pv, leave]) => [pv, leave.path, leave.scroll, leave.ms]), s.source, s.channel, s.referrer, s.campaign, s.ref,
    s.country, s.region, s.city, s.lat, s.lon, s.device, s.os, s.browser, s.opened, s.closedMs, s.named ? 1 : 0]),
  decode: json => new Map((json as unknown[][]).map(row => {
    const [key, session, visitor, surface, start, end, host, keyword, pages, goals, leaves, source, channel, referrer, campaign, ref, country, region, city, lat, lon, device, os, browser, opened, closedMs, named] = row as [
      string, string, string, Session["surface"], number, number, string | null, string | null, Array<[string, number, string | null]>, Array<[string, number, string | null]>,
      Array<[string, string, number, number]>, string, string, string | null, string | null, string | null, string | null, string | null, string | null, number | null, number | null,
      string | null, string | null, string | null, number | null, number | null, number];
    const state: Session = { session, visitor, surface, start, end, host, keyword, pages: pages.map(([path, at, pv]) => ({ path, at, pv })), goals: goals.map(([goal, at, to]) => ({ goal, at, to })),
      leaves: new Map(leaves.map(([pv, path, scroll, ms]) => [pv, { path, scroll, ms }])), entry: "", exit: "", engagedMs: 0, bounced: true,
      source, channel, referrer, campaign, ref, country, region, city, lat, lon, device, os, browser, opened, closedMs, named: named === 1 };
    return [key, state];
  })),
};

/** what one account did, for the funnel, the people firsts and retention */
export interface AccountFacts {
  /** first app pairing, first bot reply, first paid plan choice */
  paired: number | null; replied: number | null; chosen: number | null;
  /** first time of each onboarding step ("done" for onboarding_done) */
  onboarding: Map<string, number>;
  /** UTC days the account was active */
  days: Set<number>;
  /** its newest event, billing and site_section aside (the funnel's "where they stopped") */
  last: { at: number; name: string; page: string | null } | null;
  /** its events from the app, the account page and the service (retention's power users), billing aside */
  power: { first: number; last: number; seen: Set<number>; opens: number; sent: number; replies: number; features: number } | null;
}
export interface AccountsDigest { by: Map<string, AccountFacts>; identifies: number }
/** events whose rows the money views filter by the operator's own grants: never folded, read raw */
export const BILLING_EVENTS = ["billing", "checkout_paid"] as const;
const SITE_SOURCED = new Set(Object.entries(EVENTS).filter(([, spec]) => spec.source === "site").map(([name]) => name));
export const accountsDigest: Digest<AccountsDigest> = {
  kind: "accounts", version: 1,
  names: Object.keys(EVENTS).filter(name => name !== "site_section" && !(BILLING_EVENTS as readonly string[]).includes(name)),
  empty: () => ({ by: new Map(), identifies: 0 }),
  add(into, event) {
    if (event.name === "identify") into.identifies++;
    const id = event.accountId;
    if (!id) return;
    const facts = at(into.by, id, (): AccountFacts => ({ paired: null, replied: null, chosen: null, onboarding: new Map(), days: new Set(), last: null, power: null }));
    if (event.name === "app_paired") facts.paired = earliest(facts.paired, event.at);
    if (event.name === "first_bot_reply") facts.replied = earliest(facts.replied, event.at);
    if (event.name === "plan_chosen" && event.props.plan !== "free") facts.chosen = earliest(facts.chosen, event.at);
    const step = event.name === "onboarding_step" ? String(event.props.step) : event.name === "onboarding_done" ? "done" : null;
    if (step && (!facts.onboarding.has(step) || facts.onboarding.get(step)! > event.at)) facts.onboarding.set(step, event.at);
    if (isActive(event)) facts.days.add(Math.floor(event.at / DAY));
    facts.last = { at: event.at, name: event.name, page: event.name === "page_view" ? String(event.props.path) : event.ctx?.page ?? null };
    if (SITE_SOURCED.has(event.name)) return;
    const power = facts.power ??= { first: event.at, last: event.at, seen: new Set(), opens: 0, sent: 0, replies: 0, features: 0 };
    power.last = Math.max(power.last, event.at);
    power.seen.add(Math.floor(event.at / DAY));
    if (event.name === "app_open") power.opens++;
    if (event.name === "app_messages") { power.sent += Number(event.props.sent) || 0; power.replies += Number(event.props.replies) || 0; }
    if (event.name === "app_feature") power.features++;
  },
  merge(into, later) {
    into.identifies += later.identifies;
    for (const [id, next] of later.by) {
      const facts = into.by.get(id);
      if (!facts) { into.by.set(id, next); continue; }
      facts.paired = earliest(facts.paired, next.paired); facts.replied = earliest(facts.replied, next.replied); facts.chosen = earliest(facts.chosen, next.chosen);
      for (const [step, time] of next.onboarding) if (!facts.onboarding.has(step) || facts.onboarding.get(step)! > time) facts.onboarding.set(step, time);
      addSets(facts.days, next.days);
      facts.last = next.last ?? facts.last;
      if (next.power) {
        if (!facts.power) facts.power = next.power;
        else {
          const power = facts.power;
          power.last = Math.max(power.last, next.power.last); addSets(power.seen, next.power.seen);
          power.opens += next.power.opens; power.sent += next.power.sent; power.replies += next.power.replies; power.features += next.power.features;
        }
      }
    }
  },
  encode: pack,
  decode: json => unpack(json) as AccountsDigest,
};

const UPSELL_STEP: Record<string, "shown" | "clicked" | "dismissed"> = { [UPSELL_EVENTS.shown]: "shown", [UPSELL_EVENTS.click]: "clicked", [UPSELL_EVENTS.dismiss]: "dismissed" };
export type UpsellsDigest = Map<string, { shown: Set<string>; clicked: Set<string>; dismissed: Set<string> }>;
/** who saw, opened and put away each upsell surface (upsellsOf) */
export const upsellsDigest: Digest<UpsellsDigest> = {
  kind: "upsells", version: 1, names: ["page_action", "app_action"],
  empty: () => new Map(),
  add(into, event) {
    const page = event.name === "page_action";
    const step = UPSELL_STEP[String(page ? event.props.action : event.name === "app_action" ? event.props.name : event.name)];
    const source = page ? event.props.label : event.props.source;
    if (!step || typeof source !== "string" || !source) return;
    at(into, source, () => ({ shown: new Set(), clicked: new Set(), dismissed: new Set() }))[step].add(event.accountId ?? event.ctx?.visitor ?? event.id);
  },
  merge(into, later) {
    for (const [source, row] of later) {
      const mine = into.get(source);
      if (!mine) { into.set(source, row); continue; }
      addSets(mine.shown, row.shown); addSets(mine.clicked, row.clicked); addSets(mine.dismissed, row.dismissed);
    }
  },
  encode: pack,
  decode: json => unpack(json) as UpsellsDigest,
};

/** a quarter hour: the app view's days start at the reader's midnight, which is always on one */
export const QUARTER = 15 * 60_000;
export interface AppDigest {
  /** who (account, else install) was in an app in each quarter hour, and app opens per quarter hour */
  active: Map<string, Set<number>>; opens: Map<number, number>;
  installs: Set<string>; identified: Set<string>; sent: number; replies: number;
  /** reply latency (ms) weighted by replies */
  latency: Map<number, number>;
  screens: Map<string, number>; features: Map<string, number>; errors: Map<string, number>; pairFailures: Map<string, number>; platforms: Map<string, number>; versions: Map<string, number>;
}
const APP_NAMES = Object.keys(EVENTS).filter(name => name.startsWith("app_"));
const bump = (map: Map<string, number>, key: string) => map.set(key, (map.get(key) ?? 0) + 1);
/** the app view's digest, counting activity per `unit` of time (a quarter hour when stored, a millisecond for a window that starts off one) */
export const appDigestOf = (unit: number): Digest<AppDigest> => ({
  kind: "app", version: 1, names: APP_NAMES,
  empty: () => ({ active: new Map(), opens: new Map(), installs: new Set(), identified: new Set(), sent: 0, replies: 0, latency: new Map(),
    screens: new Map(), features: new Map(), errors: new Map(), pairFailures: new Map(), platforms: new Map(), versions: new Map() }),
  add(into, event) {
    if (!event.name.startsWith("app_")) return;
    const who = event.accountId ?? event.ctx?.install, quarter = Math.floor(event.at / unit);
    if (who) at(into.active, who, () => new Set()).add(quarter);
    if (event.name === "app_open") into.opens.set(quarter, (into.opens.get(quarter) ?? 0) + 1);
    if (event.ctx?.install) { into.installs.add(event.ctx.install); if (event.accountId) into.identified.add(event.ctx.install); }
    if (event.name === "app_messages") {
      into.sent += Number(event.props.sent) || 0; into.replies += Number(event.props.replies) || 0;
      if (Number(event.props.latencyMs) > 0 && Number(event.props.replies) > 0) into.latency.set(Number(event.props.latencyMs), (into.latency.get(Number(event.props.latencyMs)) ?? 0) + Number(event.props.replies));
    }
    if (event.name === "app_screen") bump(into.screens, String(event.props.screen ?? "unknown"));
    if (event.name === "app_feature") bump(into.features, String(event.props.feature ?? "unknown"));
    if (event.name === "app_error") bump(into.errors, `${event.props.kind ?? "unknown"}: ${event.props.code ?? "unknown"}`);
    if (event.name === "app_pair_failed") bump(into.pairFailures, String(event.props.reason ?? "unknown"));
    if (event.name === "app_open") {
      bump(into.platforms, event.ctx?.app?.platform ?? "unknown");
      bump(into.versions, `${event.ctx?.app?.platform ?? "?"} ${event.ctx?.app?.version ?? "?"}`);
    }
  },
  merge(into, later) {
    for (const [who, quarters] of later.active) { const mine = into.active.get(who); if (mine) addSets(mine, quarters); else into.active.set(who, quarters); }
    for (const [quarter, n] of later.opens) into.opens.set(quarter, (into.opens.get(quarter) ?? 0) + n);
    addSets(into.installs, later.installs); addSets(into.identified, later.identified);
    into.sent += later.sent; into.replies += later.replies;
    for (const [ms, n] of later.latency) into.latency.set(ms, (into.latency.get(ms) ?? 0) + n);
    for (const key of ["screens", "features", "errors", "pairFailures", "platforms", "versions"] as const) addCounts(into[key], later[key]);
  },
  encode: pack,
  decode: json => unpack(json) as AppDigest,
});
export const appDigest = appDigestOf(QUARTER);

/** the app view over [from, to) from a digest counted per `unit`; `from` must fall on a whole unit */
export function appReport(digest: AppDigest, from: number, to: number, unit = QUARTER) {
  const top = (counts: Map<string, number>, limit = 12) => [...counts].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count).slice(0, limit);
  const days = Math.ceil((to - from) / DAY), perDay = Array.from({ length: days }, () => new Set<string>()), opens = Array.from({ length: days }, () => 0);
  const dayOf = (quarter: number) => Math.floor((quarter * unit - from) / DAY);
  for (const [who, quarters] of digest.active) for (const quarter of quarters) perDay[dayOf(quarter)]?.add(who);
  for (const [quarter, n] of digest.opens) if (opens[dayOf(quarter)] !== undefined) opens[dayOf(quarter)]! += n;
  const latencies = [...digest.latency].sort((a, b) => a[0] - b[0]);
  const weight = latencies.reduce((sum, [, n]) => sum + n, 0);
  let acc = 0, latency: number | null = null;
  for (const [ms, n] of latencies) { acc += n; if (acc >= weight / 2) { latency = ms; break; } }
  return {
    from, to, days: Array.from({ length: days }, (_, i) => from + i * DAY), active: perDay.map(set => set.size), opens,
    installs: digest.installs.size, identified: digest.identified.size, sent: digest.sent, replies: digest.replies, latencyMs: latency,
    screens: top(digest.screens), features: top(digest.features), errors: top(digest.errors), pairFailures: top(digest.pairFailures), platforms: top(digest.platforms), versions: top(digest.versions),
  };
}

/** each site visit's visitor (its first page view's: a session can outlive the visitor's daily id) and start, from page views
 *  alone: the revenue funnel's "first seen" */
export const seenDigest: Digest<Map<string, { visitor: string; start: number }>> = {
  kind: "seen", version: 2, names: ["site_view"],
  empty: () => new Map(),
  add(into, event) {
    const visitor = event.ctx?.visitor, session = event.ctx?.session;
    if (event.name !== "site_view" || !session || !visitor) return;
    const visit = into.get(session);
    if (!visit) into.set(session, { visitor, start: event.at }); else visit.start = Math.min(visit.start, event.at);
  },
  merge(into, later) {
    for (const [session, next] of later) { const visit = into.get(session); if (!visit) into.set(session, next); else visit.start = Math.min(visit.start, next.start); }
  },
  encode: digest => [...digest].map(([session, visit]) => [session, visit.visitor, visit.start]),
  decode: json => new Map((json as Array<[string, string, number]>).map(([session, visitor, start]) => [session, { visitor, start }])),
};

export const DIGESTS = [visitsDigest, accountsDigest, upsellsDigest, appDigest, seenDigest, productDigest] as ReadonlyArray<Digest<unknown>>;
