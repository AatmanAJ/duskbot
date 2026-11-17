import type { StoredEvent } from "../analytics/sink.ts";
import { DAY } from "../analytics/web.ts";

export interface FunnelStepIn { id: string; label: string; count: number }
export interface ProductInput { from: number; to: number; events: StoredEvent[]; funnel: FunnelStepIn[] }

interface Count { key: string; count: number; people: number }
export interface FeatureRow { feature: string; people: number; uses: number; adoption: number | null; repeat: number | null; triedOnce: number; lift: number | null }
export interface Improvement { area: "funnel" | "errors" | "rating" | "features" | "onboarding" | "site" | "bots"; title: string; detail: string; weight: number }

/** below this many people a rate is noise, so it is not ranked */
export const MIN_PEOPLE = 3;
const POSITIVE = new Set(["yes", "love", "laugh", "celebrate"]);
const SUBKEYS = ["action", "result", "step", "view", "reason", "emoji", "variant", "source", "plan", "kind"] as const;

const whoOf = (event: StoredEvent) => event.accountId ?? event.ctx?.install ?? event.ctx?.visitor ?? null;
const dayIndex = (at: number) => Math.floor(at / DAY);
const median = (values: number[]) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b), mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid]! : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
};
const rate = (part: number, whole: number) => whole > 0 ? part / whole : null;
const words = (value: string) => value.replace(/_/g, " ");

function tally(events: StoredEvent[], key: (event: StoredEvent) => string | null, limit = 20): Count[] {
  const map = new Map<string, { count: number; people: Set<string> }>();
  for (const event of events) {
    const k = key(event);
    if (!k) continue;
    const row = map.get(k) ?? map.set(k, { count: 0, people: new Set() }).get(k)!;
    row.count++;
    const who = whoOf(event);
    if (who) row.people.add(who);
  }
  return [...map].map(([k, row]) => ({ key: k, count: row.count, people: row.people.size })).sort((a, b) => b.count - a.count || b.people - a.people).slice(0, limit);
}

/**
 * features ranked by how many people use them, how many come back to them, and whether their users stay;
 * lift is the share of a feature's users active in the window's last week minus the same share for everyone else
 */
export function featureRows(events: StoredEvent[], from: number, to: number): FeatureRow[] {
  const lastWeek = Math.max(from, to - 7 * DAY);
  const appPeople = new Set<string>(), recent = new Set<string>(), earlyFirst = new Map<string, number>();
  const uses = new Map<string, Map<string, Set<number>>>();
  for (const event of events) {
    const who = whoOf(event);
    if (!who || !event.name.startsWith("app_")) continue;
    appPeople.add(who);
    if (event.at >= lastWeek) recent.add(who);
    if (!earlyFirst.has(who) || earlyFirst.get(who)! > event.at) earlyFirst.set(who, event.at);
    if (event.name !== "app_feature" || typeof event.props.feature !== "string") continue;
    const per = uses.get(event.props.feature) ?? uses.set(event.props.feature, new Map()).get(event.props.feature)!;
    (per.get(who) ?? per.set(who, new Set()).get(who)!).add(dayIndex(event.at));
  }
  const early = [...earlyFirst].filter(([, at]) => at < lastWeek).map(([who]) => who);
  const stayed = (list: string[]) => rate(list.filter(who => recent.has(who)).length, list.length);
  return [...uses].map(([feature, per]) => {
    const users = [...per.keys()];
    const usersEarly = early.filter(who => per.has(who)), othersEarly = early.filter(who => !per.has(who));
    const usedStay = usersEarly.length >= MIN_PEOPLE ? stayed(usersEarly) : null, otherStay = othersEarly.length >= MIN_PEOPLE ? stayed(othersEarly) : null;
    const lastDay = (who: string) => Math.max(...per.get(who)!);
    return {
      feature, people: users.length, uses: [...per.values()].reduce((sum, days) => sum + days.size, 0),
      adoption: rate(users.length, appPeople.size), repeat: rate(users.filter(who => per.get(who)!.size >= 2).length, users.length),
      triedOnce: users.filter(who => per.get(who)!.size === 1 && lastDay(who) < dayIndex(lastWeek)).length,
      lift: usedStay !== null && otherStay !== null ? usedStay - otherStay : null,
    };
  }).sort((a, b) => b.people - a.people || b.uses - a.uses);
}

/** an app moment (a card, a dialog, a step) with how it went: its first telling sub-word, like action or result */
function moments(events: StoredEvent[]) {
  const map = new Map<string, { count: number; people: Set<string>; outcomes: Map<string, number> }>();
  for (const event of events) {
    if (event.name !== "app_action" || typeof event.props.name !== "string") continue;
    const row = map.get(event.props.name) ?? map.set(event.props.name, { count: 0, people: new Set(), outcomes: new Map() }).get(event.props.name)!;
    row.count++;
    const who = whoOf(event);
    if (who) row.people.add(who);
    const sub = SUBKEYS.map(key => event.props[key]).find(value => typeof value === "string");
    if (typeof sub === "string") row.outcomes.set(sub, (row.outcomes.get(sub) ?? 0) + 1);
  }
  return [...map].map(([name, row]) => ({ name, count: row.count, people: row.people.size, outcomes: [...row.outcomes].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count).slice(0, 6) }))
    .sort((a, b) => b.count - a.count).slice(0, 40);
}

function onboarding(events: StoredEvent[], to: number) {
  const steps = ["name", "plan", "app"];
  const per = new Map<string, { last: string; at: number; done: boolean }>();
  const times = new Map<string, number[]>(), reached = new Map<string, Set<string>>();
  for (const event of events) {
    if (!event.accountId) continue;
    // an account made in the desktop app sees the web welcome once, then sets up in the app: pairing it is finishing
    if (event.name === "onboarding_done" || event.name === "app_paired") { const row = per.get(event.accountId); per.set(event.accountId, { last: row?.last ?? "app", at: event.at, done: true }); continue; }
    if (event.name !== "onboarding_step" || typeof event.props.step !== "string") continue;
    const step = event.props.step;
    (reached.get(step) ?? reached.set(step, new Set()).get(step)!).add(event.accountId);
    if (typeof event.props.ms === "number") (times.get(step) ?? times.set(step, []).get(step)!).push(event.props.ms);
    const row = per.get(event.accountId);
    if (!row?.done) per.set(event.accountId, { last: step, at: event.at, done: false });
  }
  const stuck = [...per.values()].filter(row => !row.done && to - row.at > 3_600_000);
  return steps.map(step => ({ step, reached: reached.get(step)?.size ?? 0, medianMsBefore: median(times.get(step) ?? []), leftHere: stuck.filter(row => row.last === step).length }));
}

/** the desktop app's first run (opt-in app_action onboarding_step / onboarding_completed): people who reached each screen,
 * per path (where the bots live), with the median time on the screen before, so drop-off shows per step */
const APP_FIRST_RUN: Record<"all" | "mac" | "cloud", readonly string[]> = {
  all: ["welcome", "place"], mac: ["account", "ai", "bring", "phone", "permissions", "done"], cloud: ["checkout", "ai", "making", "done"],
};
export function appFirstRun(events: StoredEvent[]) {
  const pathOf = new Map<string, string>();
  for (const event of events) {
    const who = whoOf(event);
    if (who && event.name === "app_action" && event.props.name === "onboarding_step" && (event.props.path === "mac" || event.props.path === "cloud")) pathOf.set(who, event.props.path);
  }
  const reached = new Map<string, Set<string>>(), times = new Map<string, number[]>();
  for (const event of events) {
    const who = whoOf(event);
    if (!who || event.name !== "app_action" || event.props.replay === true) continue;
    const name = event.props.name;
    if (name !== "onboarding_step" && name !== "onboarding_completed") continue;
    const step = name === "onboarding_completed" ? "done" : String(event.props.step);
    const path = APP_FIRST_RUN.all.includes(step) ? "all" : typeof event.props.path === "string" ? event.props.path : pathOf.get(who) ?? "mac";
    const key = `${path}:${step}`;
    (reached.get(key) ?? reached.set(key, new Set()).get(key)!).add(who);
    if (typeof event.props.ms === "number") (times.get(key) ?? times.set(key, []).get(key)!).push(event.props.ms);
  }
  return (Object.entries(APP_FIRST_RUN) as Array<[keyof typeof APP_FIRST_RUN, readonly string[]]>).flatMap(([path, steps]) => steps
    .map(step => ({ path, step, reached: reached.get(`${path}:${step}`)?.size ?? 0, medianMsBefore: median(times.get(`${path}:${step}`) ?? []) }))
    .filter(row => row.reached > 0 || row.step !== "phone"));
}

function site(events: StoredEvent[]) {
  const views = new Map<string, number>();
  for (const event of events) if (event.name === "site_view" && typeof event.props.path === "string") views.set(event.props.path, (views.get(event.props.path) ?? 0) + 1);
  const sections = new Map<string, { path: string; section: string; seen: number; ms: number[] }>();
  for (const event of events) {
    if (event.name !== "site_section" || typeof event.props.section !== "string") continue;
    const path = String(event.props.path ?? "/"), key = `${path}#${event.props.section}`;
    const row = sections.get(key) ?? sections.set(key, { path, section: event.props.section, seen: 0, ms: [] }).get(key)!;
    row.seen++;
    if (typeof event.props.ms === "number") row.ms.push(event.props.ms);
  }
  const goals = events.filter(event => event.name === "site_goal");
  // a section the site no longer shows (the waitlist page before launch) has nothing left to fix: only the last day's sections rank
  const placeOf = (event: StoredEvent) => `${event.ctx?.page ?? "/"}#${typeof event.props.section === "string" ? event.props.section : ""}`;
  const latest = events.reduce((max, event) => event.name === "site_goal" || event.name === "site_section" ? Math.max(max, event.at) : max, 0);
  const current = new Set(events.filter(event => event.at > latest - DAY && (event.name === "site_goal" || event.name === "site_section"))
    .flatMap(event => event.name === "site_section" ? [`${String(event.props.path ?? "/")}#${String(event.props.section)}`, `${String(event.props.path ?? "/")}#`] : [placeOf(event)]));
  const goalOf = (name: string) => goals.filter(event => event.props.goal === name);
  const label = (event: StoredEvent) => [event.props.label, event.props.section].filter(value => typeof value === "string").join(" in ") || null;
  const starts = goalOf("form_start").length, abandons = goalOf("form_abandon").length;
  return {
    sections: [...sections.values()].map(row => ({ path: row.path, section: row.section, seen: row.seen, share: rate(row.seen, views.get(row.path) ?? 0), medianMs: median(row.ms) }))
      .sort((a, b) => a.path.localeCompare(b.path) || b.seen - a.seen).slice(0, 40),
    clicks: tally(goals.filter(event => event.props.goal !== "js_error" && event.props.goal !== "form_start" && event.props.goal !== "form_abandon" && event.props.goal !== "rage_click"),
      event => `${words(String(event.props.goal))}${label(event) ? `: ${words(label(event)!)}` : ""}`, 25),
    rage: tally(goalOf("rage_click").filter(event => current.size === 0 || current.has(placeOf(event))),
      event => `${event.props.label ? words(String(event.props.label)) : "empty space"}${event.props.section ? ` in the ${words(String(event.props.section))} section` : ""} of ${event.ctx?.page ?? "/"}`),
    downloads: tally(goalOf("download_click"), event => typeof event.props.value === "string" ? event.props.value : "unknown"),
    forms: { started: starts, abandoned: abandons, joined: goalOf("waitlist_join").length },
    errors: tally(goalOf("js_error"), event => event.ctx?.page ?? "unknown page"),
  };
}

function likes(events: StoredEvent[], from: number, to: number) {
  const reactions = events.filter(event => event.name === "app_action" && event.props.name === "reply_reaction" && event.props.on !== false);
  const feedback = events.filter(event => event.name === "app_feedback" && typeof event.props.score === "number");
  const scores = [1, 2, 3, 4, 5].map(score => feedback.filter(event => event.props.score === score).length);
  const byMoment = new Map<string, number[]>();
  for (const event of feedback) (byMoment.get(String(event.props.moment ?? "unknown")) ?? byMoment.set(String(event.props.moment ?? "unknown"), []).get(String(event.props.moment ?? "unknown"))!).push(Number(event.props.score));
  const created = new Map<string, number[]>();
  let deletedSoon = 0, createdCount = 0;
  for (const event of events) {
    if (event.name !== "app_feature") continue;
    const who = whoOf(event);
    if (!who) continue;
    if (event.props.feature === "bot_created") { createdCount++; (created.get(who) ?? created.set(who, []).get(who)!).push(event.at); }
    if (event.props.feature === "bot_deleted") {
      const list = created.get(who) ?? [];
      const index = list.findIndex(at => event.at - at >= 0 && event.at - at < DAY);
      if (index >= 0) { deletedSoon++; list.splice(index, 1); }
    }
  }
  let sent = 0, replies = 0;
  const senders = new Set<string>();
  for (const event of events) if (event.name === "app_messages") { sent += Number(event.props.sent) || 0; replies += Number(event.props.replies) || 0; const who = whoOf(event); if (who && Number(event.props.sent) > 0) senders.add(who); }
  const sessions = events.filter(event => event.name === "app_close" && typeof event.props.ms === "number").map(event => Number(event.props.ms));
  return {
    reactions: { positive: reactions.filter(event => POSITIVE.has(String(event.props.emoji))).length, negative: reactions.filter(event => event.props.emoji === "no").length, total: reactions.length },
    feedback: { count: feedback.length, average: feedback.length ? Math.round(feedback.reduce((sum, event) => sum + Number(event.props.score), 0) / feedback.length * 10) / 10 : null, scores,
      byMoment: [...byMoment].map(([moment, list]) => ({ moment, count: list.length, average: Math.round(list.reduce((a, b) => a + b, 0) / list.length * 10) / 10 })).sort((a, b) => a.average - b.average) },
    bots: { created: createdCount, deletedSoon },
    messages: { sent, replies, perPerson: senders.size ? Math.round(sent / senders.size) : null, days: Math.max(1, Math.round((to - from) / DAY)) },
    sessionMedianMs: median(sessions),
  };
}

const versionOf = (event: StoredEvent) => (event.ctx as { app?: { version?: unknown } } | undefined)?.app?.version;
const newer = (a: string, b: string) => { const x = a.split(".").map(Number), y = b.split(".").map(Number); for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0); return false; };
function errors(events: StoredEvent[]) {
  const errorEvents = events.filter(event => event.name === "app_error");
  const appErrors = tally(errorEvents, event => `${event.props.kind ?? "unknown"}: ${event.props.code ?? "unknown"}`);
  // the newest app anyone opened in the window, and the newest each error was seen on: an error the current app no longer
  // throws is history, not a fix
  let latest: string | null = null;
  for (const event of events) { const v = versionOf(event); if (event.name === "app_open" && typeof v === "string" && /^\d+\.\d+\.\d+$/.test(v) && (!latest || newer(v, latest))) latest = v; }
  const lastOn = new Map<string, string>();
  for (const event of errorEvents) {
    const v = versionOf(event), key = `${event.props.kind ?? "unknown"}: ${event.props.code ?? "unknown"}`, seen = lastOn.get(key);
    if (typeof v === "string" && /^\d+\.\d+\.\d+$/.test(v) && (!seen || newer(v, seen))) lastOn.set(key, v);
  }
  const app = appErrors.map(row => ({ ...row, lastVersion: lastOn.get(row.key) ?? null, latestVersion: latest }));
  const pairing = tally(events.filter(event => event.name === "app_pair_failed"), event => String(event.props.reason ?? "unknown"));
  return { app, pairing };
}

/** the few things most worth fixing, each with the number behind it; weight orders them and is roughly "share of people affected" */
export function improvements(input: { funnel: FunnelStepIn[]; features: FeatureRow[]; feedback: ReturnType<typeof likes>["feedback"]; bots: ReturnType<typeof likes>["bots"];
  onboarding: ReturnType<typeof onboarding>; site: ReturnType<typeof site>; errors: ReturnType<typeof errors>; appPeople: number }): Improvement[] {
  const out: Improvement[] = [];
  let worst: { prev: FunnelStepIn; step: FunnelStepIn; lost: number } | null = null;
  for (let i = 1; i < input.funnel.length; i++) {
    const prev = input.funnel[i - 1]!, step = input.funnel[i]!;
    if (prev.count < MIN_PEOPLE) continue;
    const lost = 1 - step.count / prev.count;
    if (!worst || lost > worst.lost) worst = { prev, step, lost };
  }
  if (worst && worst.lost > 0) out.push({ area: "funnel", title: `${Math.round(worst.lost * 100)}% stop before "${worst.step.label}"`, detail: `${worst.prev.count - worst.step.count} of ${worst.prev.count} who ${worst.prev.label} never got to the next step. the biggest drop in the funnel.`, weight: worst.lost });
  const isOld = (row: { lastVersion?: string | null; latestVersion?: string | null }) => Boolean(row.lastVersion && row.latestVersion && newer(row.latestVersion, row.lastVersion));
  const topError = [...input.errors.app, ...input.site.errors.map(row => ({ ...row, key: `site error on ${row.key}`, lastVersion: null, latestVersion: null }))]
    .sort((a, b) => Number(isOld(a)) - Number(isOld(b)) || b.people - a.people || b.count - a.count)[0];
  if (topError) {
    const { lastVersion, latestVersion } = topError;
    const old = isOld(topError);
    out.push({ area: "errors", title: `"${topError.key}" is the most common error`,
      detail: `${topError.count} times, ${topError.people} ${topError.people === 1 ? "person" : "people"}.${old ? ` last seen on ${lastVersion}, none on ${latestVersion}.` : lastVersion ? ` still seen on ${lastVersion}.` : ""}`,
      weight: (Math.min(1, topError.people / Math.max(1, input.appPeople)) + 0.2) * (old ? 0.25 : 1) });
  }
  const lowest = input.feedback.byMoment.find(row => row.count >= MIN_PEOPLE);
  if (lowest && lowest.average < 4) out.push({ area: "rating", title: `people rate "${words(lowest.moment)}" ${lowest.average} out of 5`, detail: `the lowest rated moment, from ${lowest.count} answers.`, weight: (5 - lowest.average) / 4 });
  const dropped = input.features.filter(row => row.people >= MIN_PEOPLE).map(row => ({ row, share: row.triedOnce / row.people })).sort((a, b) => b.share - a.share)[0];
  if (dropped && dropped.share >= 0.3) out.push({ area: "features", title: `${Math.round(dropped.share * 100)}% try "${words(dropped.row.feature)}" once and never again`, detail: `${dropped.row.triedOnce} of ${dropped.row.people} people used it on one day only.`, weight: dropped.share * 0.8 });
  const stuck = [...input.onboarding].sort((a, b) => b.leftHere - a.leftHere)[0];
  if (stuck && stuck.leftHere > 0) out.push({ area: "onboarding", title: `onboarding loses people at "${stuck.step}"`, detail: `${stuck.leftHere} ${stuck.leftHere === 1 ? "account stopped" : "accounts stopped"} there and did not finish.`, weight: Math.min(1, stuck.leftHere / Math.max(1, stuck.reached)) * 0.9 });
  const forms = input.site.forms;
  if (forms.started >= MIN_PEOPLE && forms.abandoned / forms.started >= 0.3) out.push({ area: "site", title: `${Math.round(forms.abandoned / forms.started * 100)}% start the waitlist form and leave`, detail: `${forms.abandoned} of ${forms.started} form starts were abandoned.`, weight: forms.abandoned / forms.started * 0.8 });
  const rage = input.site.rage[0];
  if (rage && rage.people >= 2) out.push({ area: "site", title: `rage clicks on "${rage.key}"`, detail: `${rage.count} bursts from ${rage.people} people. something there looks clickable and is not, or is slow.`, weight: 0.4 });
  if (input.bots.created >= 5 && input.bots.deletedSoon / input.bots.created >= 0.2) out.push({ area: "bots", title: `${Math.round(input.bots.deletedSoon / input.bots.created * 100)}% of new bots are deleted within a day`, detail: `${input.bots.deletedSoon} of ${input.bots.created} bots made in the window.`, weight: input.bots.deletedSoon / input.bots.created * 0.7 });
  return out.sort((a, b) => b.weight - a.weight);
}

export function productReport(input: ProductInput) {
  const events = input.events.filter(event => event.at >= input.from && event.at < input.to);
  const features = featureRows(events, input.from, input.to);
  const appPeople = new Set(events.filter(event => event.name.startsWith("app_")).map(whoOf).filter((who): who is string => !!who)).size;
  const liked = likes(events, input.from, input.to), board = onboarding(events, input.to), web = site(events), errs = errors(events);
  const pageActions = tally(events.filter(event => event.name === "page_action"), event => [event.props.action, event.props.label, event.props.value].filter(value => typeof value === "string").map(value => words(String(value))).join(": ") + (event.props.path ? ` (${event.props.path})` : ""), 25);
  const choices = tally(events.filter(event => event.name === "page_action" && event.props.action === "choose"), event => `${words(String(event.props.label ?? ""))}: ${words(String(event.props.value ?? ""))}`);
  const downloads = tally(events.filter(event => event.name === "page_action" && event.props.action === "download"), event => String(event.props.value ?? "unknown"));
  return {
    from: input.from, to: input.to, appPeople, features, moments: moments(events), likes: liked, onboarding: board, appFirstRun: appFirstRun(events), site: web, errors: errs,
    account: { actions: pageActions, choices, downloads },
    improve: improvements({ funnel: input.funnel, features, feedback: liked.feedback, bots: liked.bots, onboarding: board, site: web, errors: errs, appPeople }),
  };
}
export type ProductReport = ReturnType<typeof productReport>;
