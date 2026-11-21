import type { createBilling } from "../billing/index.ts";
import { BILLING_CONFIG } from "../billing/plans.ts";
import { BillingError, OPEN_ENDED_AT } from "../billing/service.ts";
import type { StoredSubscription } from "../billing/store.ts";
import type { AccountRef } from "../billing/types.ts";

type Billing = ReturnType<typeof createBilling>;
type Detail = Record<string, string | number | boolean | null>;

export const PLAN_ACTIONS = ["grant", "change", "interval", "set_end", "cancel", "keep", "note"] as const;
export type PlanAction = (typeof PLAN_ACTIONS)[number];
const PAID_BUNDLES = ["starter", "pro", "team"] as const;
const COMP_SOURCES = ["admin_comp", "ops_grant"];
const LIVE = ["active", "payment_problem", "cancelled"];

export class PlanError extends Error {
  status: number; code: string;
  constructor(status: number, code: string, message: string) { super(message); this.status = status; this.code = code; }
}
const invalid = (): never => { throw new PlanError(400, "invalid_request", "Invalid request."); };

export interface PlanSubscriptionRow {
  id: string; plan: string | null; bundle: string | null; interval: "month" | "year"; status: StoredSubscription["status"]; totalCents: number;
  periodStart: number | null; periodEnd: number | null; openEnded: boolean; cancelAtPeriodEnd: boolean; cloudId: string | null; source: string | null; comp: boolean; createdAt: number;
  /** dodo bills it (an ops grant on dodo test mode too): its length moves at dodo, never only here */
  dodo: boolean;
  /** test or live money: the provider's mode when it was made, else this server's */
  mode: "test" | "live";
}
export interface PlanBillingInfo { grants: boolean; provider: "preview" | "fake" | "dodo" | "off"; mode: "test" | "live"; plans: Array<{ id: string; label: string; monthlyCents: number }> }
/** what a plan-length change will do, before it is made: the confirm step shows exactly this */
export interface PlanPreview { action: "interval" | "set_end"; subscription: string; before: string; after: string; chargeNowCents: number | null; effects: string[] }

const labelOf = (bundle: string | null) => BILLING_CONFIG.bundles.find(item => item.id === bundle)?.label.toLowerCase() ?? (bundle ? "custom" : null);
const openEnded = (sub: Pick<StoredSubscription, "currentPeriodEnd">) => sub.currentPeriodEnd !== null && sub.currentPeriodEnd >= OPEN_ENDED_AT;
/** a free plan: given by the owner or ops, App Review's, or anything that costs nothing; no provider billing to move */
const isComp = (sub: Pick<StoredSubscription, "review" | "source" | "totalCents">) => sub.review === true || COMP_SOURCES.includes(sub.source ?? "") || sub.totalCents === 0;
const isoDay = (t: number) => new Date(t).toISOString().slice(0, 10);
const money = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
const every = (interval: "month" | "year") => interval === "year" ? "yearly" : "monthly";

function until(value: unknown, now: number) {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= now || value >= OPEN_ENDED_AT) return invalid();
  return value;
}

export function createPlanEditor(deps: { billing: Billing; now: () => number; audit(actor: string, action: string, target: string | null, detail: Detail): Promise<void> }) {
  const { billing, now } = deps;
  const stored = (id: string) => billing.store.state.subscriptions.find(sub => sub.id === id) ?? null;
  /** dodo bills it: this server runs dodo, and the plan came through a dodo checkout rather than a preview-era fake one */
  const dodoBilled = (sub: StoredSubscription) => billing.operator.provider === "dodo" && !!sub.providerSubscriptionId && !sub.review
    && !billing.store.state.checkouts.find(row => row.id === sub.checkoutId)?.providerSessionId?.startsWith("fake_");
  /** a comp with nothing billing it: its end lives only here */
  const freeHere = (sub: StoredSubscription) => !dodoBilled(sub) && isComp(sub);
  const bundleOf = (accountId: string, id: string) => billing.service.subscriptions(accountId).find(view => view.id === id)?.bundle ?? null;

  function describe(sub: StoredSubscription | null) {
    if (!sub) return "none";
    const end = sub.status === "ended" ? "" : openEnded(sub) ? " open-ended" : sub.currentPeriodEnd !== null ? ` until ${new Date(sub.currentPeriodEnd).toISOString().slice(0, 10)}` : "";
    return `${labelOf(bundleOf(sub.accountId, sub.id)) ?? "plan"} ${sub.status}${end}${sub.cancelAtPeriodEnd && sub.status !== "ended" ? " cancelling" : ""}`;
  }
  function subscriptions(accountId: string): PlanSubscriptionRow[] {
    return billing.service.subscriptions(accountId).map(view => {
      const sub = stored(view.id)!;
      return { id: sub.id, plan: labelOf(view.bundle), bundle: view.bundle, interval: sub.cart.interval, status: sub.status, totalCents: sub.totalCents,
        periodStart: sub.currentPeriodStart, periodEnd: sub.currentPeriodEnd, openEnded: openEnded(sub), cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
        cloudId: sub.cloudId, source: sub.source ?? null, comp: sub.review === true || COMP_SOURCES.includes(sub.source ?? ""), createdAt: sub.createdAt, dodo: dodoBilled(sub), mode: sub.mode ?? billing.operator.mode };
    });
  }
  function info(): PlanBillingInfo {
    return { grants: billing.operator.grants, provider: billing.operator.provider, mode: billing.operator.mode,
      plans: billing.service.catalog().bundles.map(bundle => ({ id: bundle.id, label: bundle.label.toLowerCase(), monthlyCents: bundle.monthlyCents })) };
  }
  function live(accountId: string, requested: unknown) {
    if (requested !== undefined && (typeof requested !== "string" || requested.length > 100)) invalid();
    const subs = billing.store.state.subscriptions.filter(sub => sub.accountId === accountId && LIVE.includes(sub.status) && (requested === undefined || sub.id === requested));
    return subs.sort((a, b) => b.createdAt - a.createdAt)[0] ?? null;
  }
  function needLive(accountId: string, requested: unknown) {
    const sub = live(accountId, requested);
    if (!sub) throw new PlanError(409, "not_subscribed", "This person has no live plan.");
    return sub;
  }
  function needGrants() { if (!billing.operator.grants) throw new PlanError(409, "grants_unavailable", "Plans can only be granted or re-dated while billing runs on the preview or fake provider."); }

  const intervalOf = (value: unknown) => value === "month" || value === "year" ? value : invalid();
  function intervalAllowed(sub: StoredSubscription, interval: "month" | "year") {
    if (freeHere(sub)) throw new PlanError(409, "comp_no_billing", "A comp has no billing period to change. Move its end date instead.");
    if (sub.status !== "active" || sub.cancelAtPeriodEnd) throw new PlanError(409, "not_active", "Only an active plan that isn't set to cancel can change its billing period.");
    if (sub.cart.interval === interval) throw new PlanError(409, "already_on_plan", "They already pay that often.");
  }
  /** a comp's end lives only here; a paid plan's next renewal moves at the provider (dodo) and here, or here alone where a fake provider holds it */
  function endChange(account: AccountRef, sub: StoredSubscription, end: number | null): () => Promise<string | null> {
    if (freeHere(sub)) return async () => { billing.operator.setEnd(account, sub.id, end ?? OPEN_ENDED_AT); return sub.id; };
    if (end === null) throw new PlanError(400, "invalid_request", "A paid plan always renews on a date.");
    if (dodoBilled(sub)) return async () => { await billing.service.moveRenewal(account, sub.id, end); return sub.id; };
    needGrants();
    return async () => { billing.operator.setEnd(account, sub.id, end); return sub.id; };
  }
  /** the exact change a plan-length edit would make, and what the provider does with it; nothing is changed */
  async function preview(account: AccountRef, input: Record<string, unknown>): Promise<PlanPreview> {
    const sub = needLive(account.id, input.subscription), plan = labelOf(bundleOf(account.id, sub.id)) ?? "plan";
    const renews = sub.currentPeriodEnd === null ? "no date" : openEnded(sub) ? "open-ended" : isoDay(sub.currentPeriodEnd);
    if (input.action === "interval") {
      const interval = intervalOf(input.interval);
      intervalAllowed(sub, interval);
      const next = billing.service.quote({ ...sub.cart, interval });
      const shown = await billing.service.previewChange(account, sub.id, next.cart), charge = shown.chargeNowCents;
      const on = (at: number | null) => at === null ? "no date" : isoDay(at);
      return { action: "interval", subscription: sub.id, before: `${plan}, ${every(sub.cart.interval)}, ${money(sub.totalCents)} a ${sub.cart.interval}, renews ${renews}`,
        after: `${plan}, ${every(interval)}, ${money(next.totalCents)} a ${interval}`, chargeNowCents: charge,
        effects: shown.timing === "trial" ? ["they are in their trial: nothing is charged now.", `the trial still ends ${on(shown.nextChargeAt)}, and the first charge is ${money(next.totalCents)}.`]
          : shown.timing === "scheduled" ? ["nothing is charged now; they keep the year they paid for.", `it switches on ${on(shown.effectiveAt)}, and ${money(next.totalCents)} is charged then.`]
          : [`${money(charge)} is charged now, tax included: the year, less the unused part of this month.`, `the billing date resets to today, and the plan renews ${on(shown.nextChargeAt)}.`] };
    }
    if (input.action === "set_end") {
      const end = until(input.until, now());
      if (freeHere(sub)) return { action: "set_end", subscription: sub.id, before: `${plan} comp, ${openEnded(sub) ? "open-ended" : `until ${renews}`}`, after: `${plan} comp, ${end === null ? "open-ended" : `until ${isoDay(end)}`}`,
        chargeNowCents: null, effects: ["a comp has no billing: only its end date here changes.", sub.cloudId ? "their cloud keeps running to the new end." : "nothing else changes."] };
      if (end === null) throw new PlanError(400, "invalid_request", "A paid plan always renews on a date.");
      const later = sub.currentPeriodEnd !== null && end > sub.currentPeriodEnd;
      return { action: "set_end", subscription: sub.id, before: `${plan}, ${every(sub.cart.interval)}, renews ${renews}`, after: `${plan}, ${every(sub.cart.interval)}, renews ${isoDay(end)}`, chargeNowCents: 0,
        effects: [dodoBilled(sub) ? "dodo moves the next billing date. nothing is charged or refunded now." : "the next renewal moves here. nothing is charged or refunded now.",
          later ? `the next charge, ${money(sub.totalCents)}, happens on ${isoDay(end)} instead: the extra days are free.` : `the next charge, ${money(sub.totalCents)}, comes early, on ${isoDay(end)}.`] };
    }
    return invalid();
  }

  async function edit(owner: AccountRef, account: AccountRef, input: Record<string, unknown>): Promise<void> {
    const action = input.action as PlanAction;
    if (!PLAN_ACTIONS.includes(action)) invalid();
    if (action === "note") {
      if (typeof input.text !== "string") invalid();
      const text = (input.text as string).trim();
      if (!text || text.length > 500) invalid();
      await deps.audit(owner.id, "person.note", account.id, { text });
      return;
    }
    let auditAction = `plan.${action}`, target: StoredSubscription | null = null, inputs: Detail = {};
    let run: () => Promise<string | null>;
    if (action === "grant") {
      if (!PAID_BUNDLES.includes(input.plan as (typeof PAID_BUNDLES)[number])) invalid();
      if (input.interval !== undefined && input.interval !== "month" && input.interval !== "year") invalid();
      const end = until(input.until, now()), interval = input.interval === "year" ? "year" as const : "month" as const;
      inputs = { plan: input.plan as string, interval, until: end };
      needGrants();
      if (live(account.id, undefined)) throw new PlanError(409, "already_subscribed", "This person already has a live plan.");
      run = async () => (await billing.operator.grant(account, { bundle: input.plan as string, interval, source: "admin_comp", amountCents: 0, until: end ?? OPEN_ENDED_AT })).subscriptionId;
    } else if (action === "change") {
      const plan = input.plan as string;
      if (plan !== "free" && !PAID_BUNDLES.includes(plan as (typeof PAID_BUNDLES)[number])) invalid();
      inputs = { plan };
      target = needLive(account.id, input.subscription);
      const sub = target;
      if (plan === "free") run = async () => { await billing.service.endNow(account, sub.id); return sub.id; };
      else {
        const bundle = BILLING_CONFIG.bundles.find(item => item.id === plan)!;
        run = async () => { await billing.service.operatorChange(account, sub.id, billing.service.quote({ ...bundle.cart, interval: sub.cart.interval }).cart); return sub.id; };
      }
    } else if (action === "interval") {
      const sub = target = needLive(account.id, input.subscription), interval = intervalOf(input.interval);
      inputs = { from: sub.cart.interval, interval };
      intervalAllowed(sub, interval);
      run = async () => { await billing.service.operatorChange(account, sub.id, billing.service.quote({ ...sub.cart, interval }).cart); return sub.id; };
    } else if (action === "set_end") {
      const end = until(input.until, now());
      inputs = { until: end };
      const sub = target = needLive(account.id, input.subscription);
      run = endChange(account, sub, end);
    } else if (action === "cancel") {
      if (input.when !== "now" && input.when !== "period_end") invalid();
      inputs = { when: input.when as string };
      auditAction = input.when === "now" ? "plan.cancel_now" : "plan.cancel_at_end";
      target = needLive(account.id, input.subscription);
      const sub = target;
      run = input.when === "now" ? async () => { await billing.service.endNow(account, sub.id); return sub.id; } : async () => { await billing.service.cancel(account, sub.id); return sub.id; };
    } else {
      target = needLive(account.id, input.subscription);
      const sub = target;
      run = async () => { await billing.service.keep(account, sub.id); return sub.id; };
    }
    const before = describe(target);
    let changed: string | null;
    try { changed = await run(); }
    catch (error) {
      const code = error instanceof BillingError || error instanceof PlanError ? error.code : "failed";
      await deps.audit(owner.id, auditAction, account.id, { ok: false, code, subscription: target?.id ?? null, ...inputs });
      if (error instanceof BillingError) throw new PlanError(error.status, error.code, error.status === 503 ? "Billing refused that change. Try again." : "That change is not possible in this plan's current state.");
      throw error;
    }
    const after = changed ? stored(changed) : null;
    await deps.audit(owner.id, auditAction, account.id, { ok: true, subscription: changed, before, after: describe(after), ...inputs });
  }
  return { edit, preview: async (account: AccountRef, input: Record<string, unknown>) => { try { return await preview(account, input); } catch (error) { if (error instanceof BillingError) throw new PlanError(error.status, error.code, "That change is not possible in this plan's current state."); throw error; } }, subscriptions, info };
}
