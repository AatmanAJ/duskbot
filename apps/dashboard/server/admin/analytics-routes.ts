import { randomBytes } from "node:crypto";
import { cancelFlowSummary } from "../analytics/cancel-flow.ts";
import type { createAuth } from "../auth/index.ts";
import type { createBilling } from "../billing/index.ts";
import type { Analytics } from "../analytics/index.ts";
import type { StoredEvent } from "../analytics/sink.ts";
import type { StoredWorkspace } from "../store.ts";
import { ACTIVE_EVENTS, DAY, DIMENSIONS, ONLINE_MS, SITE_EVENTS, SURFACES, VISIT_EVENTS, activeDays, breakdown, funnel, identityOf, kpis, matches, online, retention, series, visitsOf, type Dimension, type Filters, type People, type Visit } from "../analytics/web.ts";
import { choseCloud, wasPaid, workspaceTurns } from "./metrics.ts";
import { productReport } from "./product.ts";
import { paymentsOf, revenueReport } from "../analytics/revenue.ts";
import { aligned, newVsReturning, peakHours } from "../analytics/insights.ts";
import { billingSteps, firstSourceOf, sessionsOf, spendOf, timeToPayOf, whereOf } from "../analytics/profile.ts";
import type { StoredSubscription } from "../billing/store.ts";
import { UPSELL_EVENTS } from "../../../../shared/cloud-upsell.ts";
import { accountMrr, billingCardOf, livesOf, paysOf, subscriptionReport, type SubscriptionsInput } from "../analytics/subscriptions.ts";
import { LEDGER_LABELS } from "../billing/ledger.ts";
import { BILLING_CONFIG } from "../billing/plans.ts";
import { quote } from "../billing/pricing.ts";
import type { Step } from "../analytics/profile.ts";
import { moneyIn, opsEventOf, withoutOps, type MoneyMode } from "./money-mode.ts";
import { EVENTS } from "../analytics/events.ts";
/** the most events one person's page reads (newest kept) */
const PERSON_EVENTS = 20_000;
/** an account's face for the people views: its photo and avatar choice, when it has them */
/** the events load() reads beyond visits: when an account first paired, got a bot reply and chose a paid plan */
const PEOPLE_EVENTS = ["app_paired", "first_bot_reply", "plan_chosen"];
/** each view asks the database for only the events it reads; site_section (a quarter of all events) is read by the product view alone */
const SCANS = {
  web: [...VISIT_EVENTS, "identify", ...PEOPLE_EVENTS],
  details: [...VISIT_EVENTS, "identify"],
  journeys: [...SITE_EVENTS, "identify"],
  funnel: Object.keys(EVENTS).filter(name => name !== "site_section"),
  app: Object.keys(EVENTS).filter(name => name.startsWith("app_")),
} as const;
const face = (account: { avatarUrl?: string; avatar?: string }) => ({ ...(account.avatarUrl ? { avatarUrl: account.avatarUrl } : {}), ...(account.avatar ? { avatar: account.avatar } : {}) });

export class AnalyticsRouteError extends Error {
  status: number; code: string;
  constructor(status: number, code: string, message: string) { super(message); this.status = status; this.code = code; }
}
const bad = (message = "Invalid request.") => new AnalyticsRouteError(400, "invalid_request", message);

/** a window from the caller: from and to in ms (the page sends its own local midnight), at most 400 days */
export function windowOf(url: URL, now: number): { from: number; to: number } {
  const to = url.searchParams.has("to") ? Number(url.searchParams.get("to")) : now;
  const from = url.searchParams.has("from") ? Number(url.searchParams.get("from")) : to - 30 * DAY;
  if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from >= to || to - from > 400 * DAY || to > now + DAY) throw bad("Invalid date range.");
  return { from, to };
}
export function filtersOf(url: URL): Filters {
  const out: Filters = {};
  for (const dim of DIMENSIONS) {
    const value = url.searchParams.get(`f.${dim}`);
    if (value !== null) { if (value.length > 200) throw bad(); out[dim] = value; }
  }
  return out;
}
const surfaceOf = (url: URL) => {
  const surface = url.searchParams.get("surface") ?? "site";
  if (surface !== "all" && !(SURFACES as readonly string[]).includes(surface)) throw bad("Invalid surface.");
  return surface as (typeof SURFACES)[number] | "all";
};
const webFilters = (url: URL) => {
  const surface = surfaceOf(url), filters = filtersOf(url);
  return { surface, filters, scoped: surface === "site" || surface === "all" ? filters : { surface, ...filters } };
};

export interface UpsellRow { source: string; shown: number; clicked: number; dismissed: number; paid: number }
const UPSELL_STEP: Record<string, "shown" | "clicked" | "dismissed"> = { [UPSELL_EVENTS.shown]: "shown", [UPSELL_EVENTS.click]: "clicked", [UPSELL_EVENTS.dismiss]: "dismissed" };
/** each upsell surface (its checkout source) by people who saw it, opened it, put it away, and paid through it in the window.
 * the account page reports page_action with the step as action and the source as label; the apps report app_action with the step as name and a source prop */
export function upsellsOf(events: StoredEvent[], subscriptions: Array<Pick<StoredSubscription, "source" | "status" | "currentPeriodStart" | "createdAt">>, from: number, to: number): UpsellRow[] {
  const seen = new Map<string, { shown: Set<string>; clicked: Set<string>; dismissed: Set<string>; paid: number }>();
  for (const event of events) {
    if (event.at < from || event.at >= to) continue;
    const page = event.name === "page_action";
    const step = UPSELL_STEP[String(page ? event.props.action : event.name === "app_action" ? event.props.name : event.name)];
    const source = page ? event.props.label : event.props.source;
    if (!step || typeof source !== "string" || !source) continue;
    const who = event.accountId ?? event.ctx?.visitor ?? event.id;
    const row = seen.get(source) ?? seen.set(source, { shown: new Set(), clicked: new Set(), dismissed: new Set(), paid: 0 }).get(source)!;
    row[step].add(who);
  }
  for (const sub of subscriptions) {
    const row = sub.source ? seen.get(sub.source) : undefined;
    if (row && wasPaid(sub) && sub.createdAt >= from && sub.createdAt < to) row.paid++;
  }
  return [...seen].map(([source, row]) => ({ source, shown: row.shown.size, clicked: row.clicked.size, dismissed: row.dismissed.size, paid: row.paid }))
    .sort((a, b) => b.shown - a.shown || a.source.localeCompare(b.source));
}

type Auth = ReturnType<typeof createAuth>;
type Billing = ReturnType<typeof createBilling>;
export interface AnalyticsRoutesOptions { auth: Auth; billing: Billing; analytics: Analytics; workspaces: () => StoredWorkspace[]; now: () => number; actor: (id: string) => string | null }

export function createAnalyticsRoutes(options: AnalyticsRoutesOptions) {
  const { auth, billing, analytics, now } = options;
  /** the event log without the billing events of what the operator gave: a grant is never a payment or a subscription here */
  const sink: typeof analytics.sink = { ...analytics.sink, scan: async (since, until, names) => {
    const events = await analytics.sink.scan(since, until, names);
    if (names && !names.includes("billing") && !names.includes("checkout_paid")) return events;
    const ops = opsEventOf(billing.store.state);
    return events.filter(event => !ops(event));
  } };
  /** the money records the owner sees: with a real provider, the fake provider's checkouts (fake_ sessions) and fixture
   * ledger rows are never real money, whatever put them in the store */
  function moneyState() {
    const state = withoutOps(billing.store.state);
    if (billing.operator.provider !== "dodo") return state;
    const fakeCheckouts = new Set(state.checkouts.filter(row => row.providerSessionId?.startsWith("fake_")).map(row => row.id));
    if (!fakeCheckouts.size && !(state.ledger ?? []).some(row => row.via === "fixture")) return state;
    const fakeSubs = new Set(state.subscriptions.filter(row => fakeCheckouts.has(row.checkoutId)).map(row => row.id));
    const fakePayments = new Set(state.invoices.filter(row => row.checkoutId && fakeCheckouts.has(row.checkoutId)).map(row => row.providerPaymentId));
    return { ...state, checkouts: state.checkouts.filter(row => !fakeCheckouts.has(row.id)), subscriptions: state.subscriptions.filter(row => !fakeSubs.has(row.id)),
      invoices: state.invoices.filter(row => !fakePayments.has(row.providerPaymentId)), refunds: (state.refunds ?? []).filter(row => !fakePayments.has(row.paymentId)),
      ledger: (state.ledger ?? []).filter(row => row.via !== "fixture" && !(row.subscriptionId && fakeSubs.has(row.subscriptionId)) && !(row.providerPaymentId && fakePayments.has(row.providerPaymentId))) };
  }

  function people(): People & { cloudChosen: Map<string, number>; paired: Map<string, number>; replied: Map<string, number> } {
    const { accounts, sessions } = auth.directory();
    const state = moneyState();
    const first = (map: Map<string, number>, id: string, at: number) => { if (!map.has(id) || map.get(id)! > at) map.set(id, at); };
    const signups = new Map(accounts.map(account => [account.id, account.createdAt]));
    const paid = new Map<string, number>(), cloudChosen = new Map<string, number>(), paired = new Map<string, number>(), replied = new Map<string, number>();
    for (const sub of state.subscriptions) if (wasPaid(sub)) first(paid, sub.accountId, sub.createdAt);
    for (const invoice of state.invoices) if (invoice.status === "paid") first(paid, invoice.accountId, invoice.createdAt);
    for (const checkout of state.checkouts) if (choseCloud(checkout)) first(cloudChosen, checkout.accountId, checkout.createdAt);
    for (const session of sessions) if (session.kind !== "web") first(paired, session.accountId, session.createdAt);
    for (const ws of options.workspaces()) if (ws.ownerAccountId && workspaceTurns(ws) > 0) first(replied, ws.ownerAccountId, ws.lastReportAt ?? ws.connectedAt);
    return { signups, paid, cloudChosen, paired, replied };
  }
  async function load(from: number, names?: readonly string[]) {
    const [events, identifies] = await Promise.all([sink.scan(from, now() + 60_000, names), sink.scan(0, now() + 60_000, ["identify"])]);
    const merged = events.some(event => event.name === "identify") ? events : [...events, ...identifies];
    const identity = identityOf(identifies);
    const p = people();
    for (const event of events) {
      if (!event.accountId) continue;
      if (event.name === "app_paired" && (!p.paired.has(event.accountId) || p.paired.get(event.accountId)! > event.at)) p.paired.set(event.accountId, event.at);
      if (event.name === "first_bot_reply" && (!p.replied.has(event.accountId) || p.replied.get(event.accountId)! > event.at)) p.replied.set(event.accountId, event.at);
      if (event.name === "plan_chosen" && event.props.plan !== "free" && (!p.cloudChosen.has(event.accountId) || p.cloudChosen.get(event.accountId)! > event.at)) p.cloudChosen.set(event.accountId, event.at);
    }
    return { events: merged, identity, people: p, visits: visitsOf(events) };
  }

  async function web(url: URL) {
    const { from, to } = windowOf(url, now()), span = to - from;
    const { surface, filters, scoped } = webFilters(url);
    const time = now();
    const [{ identity, people: p, events }, recent, crawls, notes] = await Promise.all([load(Math.min(from - span, from - 60 * DAY), SCANS.web), sink.scan(time - ONLINE_MS, time + 60_000),
      sink.crawls(from, to), sink.notes(from - span, to)]);
    const all = visitsOf(events, SURFACES), visits = all.filter(visit => surface === "all" || visit.surface === surface);
    const current = kpis(visits, identity, p, from, to, scoped), previous = kpis(visits, identity, p, from - span, from, scoped);
    const cards = Object.fromEntries(DIMENSIONS.map(dim => [dim, breakdown(visits, identity, p, dim, from, to, scoped)]));
    const surfaces = Object.fromEntries(SURFACES.map(value => [value, new Set(all.filter(visit => visit.surface === value && visit.start >= from && visit.start < to).map(visit => visit.visitor)).size]));
    const allowed = Object.keys(scoped).length ? new Set(visits.filter(visit => visit.start >= from && visit.start < to && matches(visit, scoped)).map(visit => visit.visitor.startsWith("acct_") ? visit.visitor : identity.accountOf.get(visit.visitor))) : null;
    const accounts = new Map(auth.directory().accounts.map(account => [account.id, account]));
    const marks = (["signup", "paid"] as const).flatMap(kind => [...(kind === "signup" ? p.signups : p.paid)].filter(([id, at]) => at >= from && at < to && (!allowed || allowed.has(id)))
      .map(([id, at]) => ({ at, kind, seed: [...(identity.visitorsOf.get(id) ?? [])][0] ?? id, email: accounts.get(id)?.email ?? null, customer: p.paid.has(id) })))
      .sort((a, b) => b.at - a.at || a.seed.localeCompare(b.seed)).slice(0, 60);
    const live = online(recent, time, analytics.presence.list().map(entry => entry.key));
    const money = moneyState();
    const revenue = revenueReport({ payments: paymentsOf(money), subscriptions: money.subscriptions, visits, identity, from, to, now: now(), filters: scoped,
      accounts: new Map([...accounts].map(([id, account]) => [id, { email: account.email, createdAt: account.createdAt }])) });
    const count = (values: string[]) => [...values.reduce((map, value) => map.set(value, (map.get(value) ?? 0) + 1), new Map<string, number>())]
      .map(([key, requests]) => ({ key, visitors: requests, signups: 0, paid: 0 })).sort((a, b) => b.visitors - a.visitors).slice(0, 50);
    const chart = series(visits, p, from, to, scoped, identity);
    const tz = url.searchParams.has("tz") ? Number(url.searchParams.get("tz")) : 0;
    if (!Number.isInteger(tz) || tz < -900 || tz > 900) throw bad();
    const insights = { previousVisitors: aligned(series(visits, p, from - span, from, scoped, identity).visitors, chart.starts.length),
      visitors: newVsReturning(visits, from, to, scoped), hours: peakHours(visits, from, to, tz, scoped) };
    // payments are live when the server takes live money, sold or not; before the first sale the chart says no sales
    return { from, to, now: now(), filters, current, previous, surfaces, marks, online: live, series: chart, insights, cards, revenue: { ...revenue, live: revenue.live || serverMode() === "live" }, notes,
      tracked: visits.length > 0, crawlers: { total: crawls.length, bot: count(crawls.map(c => c.bot)), page: count(crawls.map(c => c.path)), kind: count(crawls.map(c => c.kind)) } };
  }

  async function webDetails(dim: Dimension, url: URL) {
    const { from, to } = windowOf(url, now()), { surface, filters, scoped } = webFilters(url);
    const { events, identity, people: p } = await load(from, SCANS.details);
    const visits = visitsOf(events, SURFACES).filter(visit => surface === "all" || visit.surface === surface);
    const rows = breakdown(visits, identity, p, dim, from, to, scoped, 500).map(row => {
      const { conversion, bounce, visitMs, pageviews } = kpis(visits, identity, p, from, to, { ...scoped, [dim]: row.key });
      return { ...row, conversion, bounce, visitMs, pageviews };
    });
    return { from, to, dimension: dim, filters, rows };
  }

  async function funnelRoute(url: URL) {
    const { from, to } = windowOf(url, now());
    const mode = url.searchParams.get("mode") === "signups" ? "signups" : "visitors";
    const { events, identity, people: p, visits } = await load(from, SCANS.funnel);
    return { from, to, ...funnel({ from, to, now: now(), mode, visits, identity, events, people: p, cloudChosen: p.cloudChosen, paired: p.paired, replied: p.replied }),
      upsells: upsellsOf(events, moneyState().subscriptions, from, to) };
  }

  function personOf(visits: Visit[]) {
    const first = visits[0]!, last = visits.at(-1)!;
    return { visits: visits.length, pageviews: visits.reduce((sum, visit) => sum + visit.pages.length, 0), firstSeen: first.start, lastSeen: last.end,
      source: first.source, channel: first.channel, campaign: first.campaign, device: first.device, os: first.os, browser: first.browser, country: first.country, city: first.city,
      lastPage: last.exit };
  }

  async function journeys(url: URL) {
    const { from, to } = windowOf(url, now());
    const only = url.searchParams.get("only") ?? "all";
    if (!["all", "signups", "customers"].includes(only)) throw bad();
    const q = (url.searchParams.get("q") ?? "").trim().toLowerCase().slice(0, 100);
    const { identity, people: p, visits } = await load(from - 90 * DAY, SCANS.journeys);
    const emails = new Map(auth.directory().accounts.map(account => [account.id, account]));
    const groups = new Map<string, Visit[]>();
    for (const visit of visits) {
      const key = identity.accountOf.get(visit.visitor) ?? visit.visitor;
      (groups.get(key) ?? groups.set(key, []).get(key)!).push(visit);
    }
    for (const [account, at] of p.signups) if (at >= from && at < to && !groups.has(account)) groups.set(account, []);
    const rows = [];
    for (const [key, list] of groups) {
      const account = emails.get(key) ?? null;
      const recent = list.some(visit => visit.end >= from && visit.start < to) || (account && account.createdAt >= from && account.createdAt < to);
      if (!recent) continue;
      const summary = list.length ? personOf(list) : null;
      const signedUp = account ? account.createdAt : null, paidAt = account ? p.paid.get(account.id) ?? null : null;
      const firstSeen = summary?.firstSeen ?? signedUp;
      rows.push({ id: key, seed: list[0]?.visitor ?? key, account: account ? { id: account.id, email: account.email, name: account.name, ...face(account) } : null, customer: paidAt !== null,
        signedUpAt: signedUp, paidAt, firstSeen, lastSeen: summary?.lastSeen ?? signedUp, timeToSignupMs: signedUp !== null && firstSeen !== null ? Math.max(0, signedUp - firstSeen) : null,
        visits: summary?.visits ?? 0, pageviews: summary?.pageviews ?? 0, source: summary?.source ?? "unknown", channel: summary?.channel ?? "unknown", campaign: summary?.campaign ?? null,
        device: summary?.device ?? null, os: summary?.os ?? null, browser: summary?.browser ?? null, country: summary?.country ?? null, city: summary?.city ?? null, lastPage: summary?.lastPage ?? null });
    }
    let list = rows;
    if (only === "signups") list = list.filter(row => row.account);
    if (only === "customers") list = list.filter(row => row.customer);
    if (q) list = list.filter(row => row.id.toLowerCase().includes(q) || row.account?.email.includes(q) || (row.account?.name ?? "").toLowerCase().includes(q) || row.source.toLowerCase().includes(q));
    list.sort((a, b) => Number(b.customer) - Number(a.customer) || (b.lastSeen ?? 0) - (a.lastSeen ?? 0));
    return { from, to, total: list.length, people: list.slice(0, 200) };
  }

  function billingCard(accountId: string) {
    const input = subscriptionInput(new Map());
    const card = billingCardOf(subscriptionReport(input), input, accountId);
    if (!card) return null;
    const sub = billing.store.state.subscriptions.filter(row => row.accountId === accountId && row.status !== "pending").sort((a, b) => b.createdAt - a.createdAt)[0];
    return { ...card, events: card.events.map(event => ({ ...event, label: LEDGER_LABELS[event.type]?.label ?? event.type, emoji: LEDGER_LABELS[event.type]?.emoji ?? "•", plan: event.plan ? planLabel(event.plan) : null })),
      cancelAtPeriodEnd: sub?.cancelAtPeriodEnd ?? false, currentPeriodEnd: sub?.currentPeriodEnd ?? null };
  }
  async function profile(id: string) {
    const idents = await sink.scan(0, now() + 60_000, ["identify"]);
    const identity = identityOf(idents);
    // an app install that never signed in is `install:<id>`, like the people list names it
    const install = id.startsWith("install:") ? id.slice("install:".length) : null;
    const account = id.startsWith("acct_") ? id : identity.accountOf.get(id) ?? null;
    const visitors = new Set(account ? identity.visitorsOf.get(account) ?? [] : install ? [] : [id]);
    if (!account && !install) visitors.add(id);
    const installs = new Set(account ? identity.installsOf.get(account) ?? [] : install ? [install] : []);
    // one person's events from the indexes, not a scan of everyone's 400 days
    const ops = opsEventOf(billing.store.state);
    const mine = (await sink.person({ accountId: account, visitors: [...visitors], installs: [...installs], since: now() - 400 * DAY, limit: PERSON_EVENTS })).filter(event => !ops(event));
    if (!mine.length && !account) throw new AnalyticsRouteError(404, "not_found", "Not found.");
    const owner = account ? auth.directory().accounts.find(item => item.id === account) ?? null : null;
    const p = people();
    const visits = visitsOf(mine);
    const state = moneyState();
    const payments = account ? paymentsOf(state).filter(payment => payment.accountId === account) : [];
    const checkouts = account ? state.checkouts.filter(checkout => checkout.accountId === account) : [];
    // billing records are the source of truth for money; the paid event only stands in when they are gone
    const kept = (payments.length ? mine.filter(event => event.name !== "checkout_paid") : mine).filter(event => event.name !== "billing");
    const sessions = sessionsOf(kept, [...billingSteps(payments, checkouts), ...(account ? ledgerSteps(account) : [])]);
    const firstSeen = sessions.length ? sessions.at(-1)!.start : owner?.createdAt ?? null;
    const spend = spendOf(payments, account ? p.paid.get(account) ?? null : null);
    const firstSource = firstSourceOf(visitsOf(mine, ["site", "account"]));
    const surface = (event: StoredEvent) => event.name.startsWith("site_") ? "site" : event.name.startsWith("app_") ? "app" : event.name === "page_view" || event.name.startsWith("onboarding") || event.name === "plan_chosen" ? "account" : "server";
    const timeline = mine.filter(event => event.name !== "site_leave" && event.name !== "page_leave").slice(-400).reverse().map(event => ({ at: event.at, name: event.name, surface: surface(event), props: event.props,
      page: event.ctx?.page ?? null, source: event.ctx?.source ?? null, country: event.ctx?.country ?? null, device: event.ctx?.device ?? null, app: event.ctx?.app ?? null }));
    return {
      id, seed: [...visitors][0] ?? id, account: owner ? { id: owner.id, email: owner.email, name: owner.name, createdAt: owner.createdAt, ...face(owner) } : null,
      customer: !!(account && p.paid.has(account)), paidAt: account ? p.paid.get(account) ?? null : null, visitors: visitors.size, installs: installs.size,
      summary: visits.length ? personOf(visits) : null, timeline,
      where: whereOf(mine), firstSource, sessions: sessions.slice(0, 120),
      stats: { firstSeen, visits: sessions.filter(session => session.surface !== "server").length, pageviews: kept.filter(event => event.name === "site_view" || event.name === "page_view").length,
        ...spend, timeToPayMs: timeToPayOf(firstSeen, spend.firstPaidAt) },
      billing: account ? billingCard(account) : null,
    };
  }

  async function realtime(url: URL) {
    const minutes = Number(url.searchParams.get("minutes") ?? "30");
    if (!Number.isInteger(minutes) || minutes < 5 || minutes > 480) throw bad();
    const time = now(), since = time - minutes * 60_000;
    const [events, idents] = await Promise.all([sink.scan(since, time + 60_000), sink.scan(0, time + 60_000, ["identify"])]);
    const identity = identityOf(idents);
    const p = people();
    const accounts = new Map(auth.directory().accounts.map(account => [account.id, account]));
    const NOTABLE = new Set(["site_view", "site_goal", "page_view", "signup", "app_paired", "first_bot_reply", "checkout_paid", "app_open"]);
    const geo = new Map<string, { country?: string; city?: string; lat?: number; lon?: number }>();
    for (const event of events) if (event.ctx?.visitor && (event.ctx.country || event.ctx.lat !== undefined)) geo.set(event.ctx.visitor, { country: event.ctx.country, city: event.ctx.city, lat: event.ctx.lat, lon: event.ctx.lon });
    const seedOf = (event: StoredEvent) => event.ctx?.visitor ?? (event.accountId ? [...(identity.visitorsOf.get(event.accountId) ?? [])][0] ?? event.accountId : event.ctx?.install ?? event.id);
    const feed = events.filter(event => NOTABLE.has(event.name)).slice(-300).reverse().map(event => {
      const account = event.accountId ?? (event.ctx?.visitor ? identity.accountOf.get(event.ctx.visitor) ?? null : null);
      const where = event.ctx?.visitor ? geo.get(event.ctx.visitor) : undefined;
      return { id: event.id, at: event.at, name: event.name, seed: seedOf(event), email: account ? accounts.get(account)?.email ?? null : null, customer: !!(account && p.paid.has(account)),
        page: event.ctx?.page ?? (typeof event.props.path === "string" ? event.props.path : null), goal: typeof event.props.goal === "string" ? event.props.goal : null,
        source: event.ctx?.source ?? null, country: where?.country ?? event.ctx?.country ?? null, city: where?.city ?? event.ctx?.city ?? null, lat: where?.lat ?? event.ctx?.lat ?? null, lon: where?.lon ?? event.ctx?.lon ?? null };
    });
    const latest = new Map<string, (typeof feed)[number]>();
    for (const item of feed) if (item.at >= time - 5 * 60_000 && (item.name === "site_view" || item.name === "site_goal" || item.name === "page_view") && !latest.has(item.seed)) latest.set(item.seed, item);
    const present = analytics.presence.list(time);
    for (const entry of present.reverse()) {
      if (latest.has(entry.key)) continue;
      const account = entry.owner ? null : identity.accountOf.get(entry.key) ?? null;
      latest.set(entry.key, { id: `here_${entry.key}`, at: entry.at, name: "site_view", seed: entry.key, email: account ? accounts.get(account)?.email ?? null : null,
        customer: !!(account && p.paid.has(account)), page: entry.page, goal: null, source: null, country: entry.country ?? null, city: entry.city ?? null, lat: entry.lat ?? null, lon: entry.lon ?? null });
    }
    return { now: time, minutes, online: online(events, time, present.map(entry => entry.key)), here: [...latest.values()], feed };
  }

  async function retentionRoute() {
    const time = now();
    const events = await sink.scan(time - 120 * DAY, time + 60_000);
    const p = people();
    const days = activeDays(events);
    const cohorts = retention(p.signups, days, time);
    const accounts = new Map(auth.directory().accounts.map(account => [account.id, account]));
    const since = time - 30 * DAY;
    const power = new Map<string, { days: Set<number>; opens: number; sent: number; replies: number; features: number; lastAt: number }>();
    for (const event of events) {
      if (!event.accountId || event.at < since) continue;
      const row = power.get(event.accountId) ?? power.set(event.accountId, { days: new Set(), opens: 0, sent: 0, replies: 0, features: 0, lastAt: 0 }).get(event.accountId)!;
      if (days.get(event.accountId)?.has(Math.floor(event.at / DAY))) row.days.add(Math.floor(event.at / DAY));
      if (event.name === "app_open") row.opens++;
      if (event.name === "app_messages") { row.sent += Number(event.props.sent) || 0; row.replies += Number(event.props.replies) || 0; }
      if (event.name === "app_feature") row.features++;
      row.lastAt = Math.max(row.lastAt, event.at);
    }
    const users = [...power].filter(([id]) => accounts.has(id)).map(([id, row]) => ({ id, email: accounts.get(id)!.email, name: accounts.get(id)!.name, ...face(accounts.get(id)!), activeDays: row.days.size, opens: row.opens,
      sent: row.sent, replies: row.replies, features: row.features, lastAt: row.lastAt, customer: p.paid.has(id) }))
      .sort((a, b) => b.activeDays - a.activeDays || b.sent - a.sent).slice(0, 25);
    return { now: time, cohorts, power: users };
  }

  async function app(url: URL) {
    const { from, to } = windowOf(url, now());
    const events = (await sink.scan(from, to, SCANS.app)).filter(event => event.name.startsWith("app_"));
    const top = (values: string[], limit = 12) => {
      const counts = new Map<string, number>();
      for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
      return [...counts].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count).slice(0, limit);
    };
    const days = Math.ceil((to - from) / DAY), perDay = Array.from({ length: days }, () => new Set<string>()), opens = Array.from({ length: days }, () => 0);
    const installs = new Set<string>(), identified = new Set<string>();
    let sent = 0, replies = 0;
    const latencies: Array<[number, number]> = [];
    for (const event of events) {
      const who = event.accountId ?? event.ctx?.install;
      const index = Math.floor((event.at - from) / DAY);
      if (who && perDay[index]) perDay[index]!.add(who);
      if (event.name === "app_open" && opens[index] !== undefined) opens[index]! += 1;
      if (event.ctx?.install) { installs.add(event.ctx.install); if (event.accountId) identified.add(event.ctx.install); }
      if (event.name === "app_messages") {
        sent += Number(event.props.sent) || 0; replies += Number(event.props.replies) || 0;
        if (Number(event.props.latencyMs) > 0 && Number(event.props.replies) > 0) latencies.push([Number(event.props.latencyMs), Number(event.props.replies)]);
      }
    }
    latencies.sort((a, b) => a[0] - b[0]);
    const weight = latencies.reduce((sum, [, n]) => sum + n, 0);
    let acc = 0, latency: number | null = null;
    for (const [ms, n] of latencies) { acc += n; if (acc >= weight / 2) { latency = ms; break; } }
    const of = (name: string, prop: string) => events.filter(event => event.name === name).map(event => String(event.props[prop] ?? "unknown"));
    return {
      from, to, days: Array.from({ length: days }, (_, i) => from + i * DAY), active: perDay.map(set => set.size), opens,
      installs: installs.size, identified: identified.size, sent, replies, latencyMs: latency,
      screens: top(of("app_screen", "screen")), features: top(of("app_feature", "feature")),
      errors: top(events.filter(event => event.name === "app_error").map(event => `${event.props.kind ?? "unknown"}: ${event.props.code ?? "unknown"}`)),
      pairFailures: top(of("app_pair_failed", "reason")),
      platforms: top(events.filter(event => event.name === "app_open").map(event => event.ctx?.app?.platform ?? "unknown")),
      versions: top(events.filter(event => event.name === "app_open").map(event => `${event.ctx?.app?.platform ?? "?"} ${event.ctx?.app?.version ?? "?"}`)),
    };
  }

  async function product(url: URL) {
    const { from, to } = windowOf(url, now());
    const { events, identity, people: p, visits } = await load(from);
    const flow = funnel({ from, to, now: now(), mode: "visitors", visits, identity, events, people: p, cloudChosen: p.cloudChosen, paired: p.paired, replied: p.replied });
    return productReport({ from, to, events, funnel: flow.steps });
  }

  const planLabel = (id: string) => BILLING_CONFIG.bundles.find(bundle => bundle.id === id)?.label.toLowerCase() ?? (id === "custom" ? "custom" : id.replace(/_/g, " "));
  const planOf = (sub: StoredSubscription) => { try { return planLabel(quote(sub.cart, BILLING_CONFIG).bundle ?? "custom"); } catch { return "custom"; } };
  function subscriptionInput(activity: ReadonlyMap<string, number>): SubscriptionsInput {
    const state = moneyState();
    return { subscriptions: state.subscriptions, invoices: state.invoices, refunds: state.refunds ?? [], ledger: state.ledger ?? [], checkouts: state.checkouts, customers: state.customers,
      accounts: new Map(auth.directory().accounts.map(account => [account.id, { email: account.email, createdAt: account.createdAt, name: account.name ?? null }])), activity, planOf, planLabel, now: now(),
      modeOf: sub => sub.mode ?? serverMode() };
  }
  /** the money records this server holds were made in its provider's mode unless stamped otherwise: preview's dodo is test */
  const serverMode = (): MoneyMode => billing.operator.mode ?? "live";
  const scoped = (input: SubscriptionsInput, want: MoneyMode | "all"): SubscriptionsInput => moneyIn(input, want, serverMode());
  function moneyTotals(input: SubscriptionsInput) {
    const report = subscriptionReport(input);
    return { mrr: report.headline.mrr, customers: report.headline.customers, gross: report.cash.gross, payments: report.cash.payments };
  }
  /** each paying customer's first touch, kept on the billing record once known so it outlives the raw events */
  function attribute(paying: ReadonlySet<string>, events: readonly StoredEvent[]) {
    const missing = billing.store.state.customers.filter(row => paying.has(row.accountId) && !row.attribution).map(row => row.accountId);
    if (!missing.length) return;
    const identity = identityOf(events.filter(event => event.name === "identify"));
    const visits = visitsOf(events, ["site", "account"]);
    for (const accountId of missing) {
      const mine = new Set([accountId, ...(identity.visitorsOf.get(accountId) ?? [])]);
      const first = firstSourceOf(visits.filter(visit => mine.has(visit.visitor) || identity.accountOf.get(visit.visitor) === accountId));
      if (!first) continue;
      const visit = visits.find(item => item.start === first.at);
      billing.service.setAttribution(accountId, { source: first.source, channel: first.channel, campaign: first.campaign, referrer: first.referrer, country: visit?.country ?? null, firstSeen: first.at });
    }
  }
  async function revenueData() {
    const time = now();
    const [recent, history] = await Promise.all([sink.scan(time - 14 * DAY, time + 60_000, ACTIVE_EVENTS), sink.scan(time - 400 * DAY, time + 60_000, ["site_view", "page_view", "identify"])]);
    const activity = new Map([...activeDays(recent)].map(([id, days]) => [id, days.size]));
    const input = subscriptionInput(activity);
    const pays = paysOf(input), paying = new Set([...pays.map(pay => pay.accountId), ...input.subscriptions.filter(sub => sub.status !== "pending" && !sub.review).map(sub => sub.accountId)]);
    attribute(paying, history);
    return { input: subscriptionInput(activity), history };
  }
  /** visitor, signup, checkout, paid and still paying a month after: people first seen in the window */
  function revenueFunnel(input: SubscriptionsInput, history: readonly StoredEvent[], days: number) {
    const time = now(), from = time - days * DAY;
    const identity = identityOf(history.filter(event => event.name === "identify"));
    const first = new Map<string, number>();
    for (const visit of visitsOf(history)) {
      const who = identity.accountOf.get(visit.visitor) ?? visit.visitor;
      if (!first.has(who) || first.get(who)! > visit.start) first.set(who, visit.start);
    }
    for (const [id, account] of input.accounts) if (!first.has(id) || first.get(id)! > account.createdAt) first.set(id, account.createdAt);
    const pays = paysOf(input), lives = livesOf(input, pays, time);
    const firstPaid = new Map<string, number>();
    for (const life of lives) if (!life.comp && (!firstPaid.has(life.accountId) || firstPaid.get(life.accountId)! > life.start)) firstPaid.set(life.accountId, life.start);
    const checkout = new Set(input.checkouts.filter(row => row.source !== "ops_grant" && row.source !== "admin_comp").map(row => row.accountId));
    const people = [...first].filter(([, at]) => at >= from && at < time).map(([id]) => id);
    const signed = people.filter(id => input.accounts.has(id)), started = signed.filter(id => checkout.has(id) || firstPaid.has(id)), paid = started.filter(id => firstPaid.has(id));
    const eligible = paid.filter(id => firstPaid.get(id)! + 30 * DAY <= time);
    const retained = eligible.filter(id => (accountMrr(lives, firstPaid.get(id)! + 30 * DAY).get(id) ?? 0) > 0);
    return { days, steps: [{ id: "visit", label: "visited", count: people.length }, { id: "signup", label: "signed up", count: signed.length }, { id: "checkout", label: "started checkout", count: started.length },
      { id: "paid", label: "paid", count: paid.length }, { id: "retained", label: "still paying in month 2", count: retained.length, of: eligible.length }] };
  }
  async function revenue(url: URL) {
    const days = Number(url.searchParams.get("days") ?? "90");
    if (!Number.isInteger(days) || days < 7 || days > 400) throw bad();
    const asked = url.searchParams.get("mode") ?? "live";
    if (asked !== "live" && asked !== "test" && asked !== "all") throw bad();
    const { input: every, history } = await revenueData();
    const input = scoped(every, asked), state = billing.store.state;
    return { ...subscriptionReport(input), funnel: revenueFunnel(input, history, days), mode: asked, serverMode: serverMode(),
      modes: { live: moneyTotals(scoped(every, "live")), test: moneyTotals(scoped(every, "test")) }, sync: { available: billing.operator.provider === "dodo", last: state.lastSync ?? null },
      cancelFlow: cancelFlowSummary(state.retention ?? [], now() - 90 * DAY, now() + 1) };
  }
  function ledgerSteps(accountId: string): Step[] {
    const skip = new Set(["payment.succeeded", "refund.succeeded", "subscription.renewed", "subscription.active", "checkout.started"]);
    return (moneyState().ledger ?? []).filter(row => row.accountId === accountId && !skip.has(row.type) && LEDGER_LABELS[row.type]).map(row => {
      const delta = row.mrrCents !== null && row.previousMrrCents !== null ? row.mrrCents - row.previousMrrCents : null;
      return { at: row.at, kind: "billing", surface: "server", name: LEDGER_LABELS[row.type]!.label, emoji: LEDGER_LABELS[row.type]!.emoji, path: null,
        detail: row.reason ?? (row.plan ? planLabel(row.plan) : null), amountCents: delta ?? (row.type.startsWith("payment.") || row.type.startsWith("dispute.") ? row.amountCents : null) };
    });
  }

  async function saveNote(actor: string, input: Record<string, unknown>, id?: string) {
    // oxlint-disable-next-line no-control-regex -- control characters are what this strips or refuses
    const text = typeof input.text === "string" ? input.text.replace(/[\u0000-\u001f]/g, " ").trim() : "";
    const at = Number(input.at);
    if (!text || text.length > 140 || !Number.isSafeInteger(at) || at < 0 || at > now() + 365 * DAY) throw bad("A note needs a date and 1 to 140 characters.");
    const existing = id ? (await sink.notes(0, Number.MAX_SAFE_INTEGER)).find(note => note.id === id) : null;
    if (id && !existing) throw new AnalyticsRouteError(404, "not_found", "Not found.");
    const note = { id: id ?? `note_${randomBytes(9).toString("base64url")}`, at, text, by: existing?.by ?? actor, createdAt: existing?.createdAt ?? now() };
    await sink.saveNote(note);
    return note;
  }

  return { revenue, customers: () => subscriptionReport(scoped(subscriptionInput(new Map()), serverMode())).customers, syncRevenue: () => billing.service.syncFromProvider(), web, webDetails, funnel: funnelRoute, journeys, profile, realtime, retention: retentionRoute, app, product, saveNote, deleteNote: (id: string) => sink.deleteNote(id), isDimension: (value: string): value is Dimension => (DIMENSIONS as readonly string[]).includes(value) };
}
