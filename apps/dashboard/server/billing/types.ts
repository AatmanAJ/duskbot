import type { IncomingMessage } from "node:http";

/** what a checkout charges, as product ids the provider knows (plans.ts dodoCart): the base line, the rest as addons */
export interface ProviderCartLine { productId: string; quantity: number; addons: Array<{ addonId: string; quantity: number }> }

export interface CreateCheckoutInput {
  /** our checkout id; sent as metadata and read back from every webhook */
  checkoutId: string;
  accountId: string;
  email: string;
  /** the account's own name, else none: the checkout's name field is filled from it or from the email */
  name?: string | null;
  customerId: string | null;
  cart: ProviderCartLine[];
  returnUrl: string;
  /** a free trial before the first charge (dodo subscription_data.trial_period_days) */
  trialDays?: number;
  /** local quote for the fake provider; never sent to dodo */
  billing?: { interval: "month" | "year" | null; amountCents: number; currency: string };
}

/** a provider webhook after its signature was verified, mapped to our words */
/** what a payment or subscription webhook also told us, kept on the billing ledger for the owner's numbers; every field is
 *  optional and a malformed one is dropped, never a reason to refuse the delivery */
export interface ProviderDetails {
  /** the provider's own time for the object (created_at), else null */
  createdAt?: number | null;
  /** settlement_amount and settlement_tax, in the settlement currency (USD for us) */
  settlementCents?: number | null; settlementTaxCents?: number | null; taxCents?: number | null; settlementCurrency?: string | null;
  /** billing.country, two letters */
  country?: string | null;
  errorCode?: string | null; reason?: string | null;
  /** a subscription's recurring price before tax and how often it bills */
  recurringCents?: number | null; interval?: "month" | "year" | null;
  cancelledAt?: number | null;
}
export type BillingEvent =
  | ({ kind: "subscription"; type: "active" | "renewed" | "on_hold" | "failed" | "cancelled" | "expired" | "plan_changed" | "updated";
      subscriptionId: string; customerId: string | null; checkoutId: string | null; accountId: string | null; productId: string | null;
      addons: Array<{ addonId: string; quantity: number }>; nextBillingAt: number | null; cancelAtPeriodEnd: boolean; status: string | null } & ProviderDetails)
  | ({ kind: "payment"; type: "succeeded" | "failed"; paymentId: string; subscriptionId: string | null; customerId: string | null;
      checkoutId: string | null; accountId: string | null; amountCents: number; currency: string } & ProviderDetails)
  | ({ kind: "refund"; refundId: string; paymentId: string; amountCents: number; currency: string } & ProviderDetails)
  /** a chargeback: opened, then challenged, won, lost, accepted, cancelled or expired. Recorded only; billing state is unchanged */
  | ({ kind: "dispute"; type: "opened" | "challenged" | "accepted" | "cancelled" | "expired" | "won" | "lost"; disputeId: string; paymentId: string;
      amountCents: number; currency: string; stage: string | null } & ProviderDetails)
  | { kind: "ignored"; type: string; data?: Record<string, unknown> };

export interface VerifiedWebhook { id: string; at: number; event: BillingEvent }

/** a percent off the subscription's next `cycles` renewals, made for one account and used once */
export interface ApplyDiscountInput { subscriptionId: string; productId: string; addons: Array<{ addonId: string; quantity: number }>; percent: number; cycles: number; accountId: string }
export interface ChangePlanInput { subscriptionId: string; productId: string; addons: Array<{ addonId: string; quantity: number }>; billing?: CreateCheckoutInput["billing"] }

/** payments backend: fake for tests and dev, dodo when configured. no method ever logs a secret. */
export interface BillingProvider {
  readonly name: "fake" | "dodo";
  createCheckout(input: CreateCheckoutInput): Promise<{ sessionId: string; url: string }>;
  /** a card-only page for a subscription's payment method. never the provider's customer portal: that one can cancel past our cancel flow */
  updatePaymentMethod(subscriptionId: string, returnUrl: string): Promise<{ url: string }>;
  /** throws BillingProviderError("bad_signature") unless the raw body is signed and fresh */
  verifyWebhook(headers: Record<string, string | string[] | undefined>, rawBody: Buffer): VerifiedWebhook;
  cancelAtPeriodEnd(subscriptionId: string, cancel: boolean): Promise<void>;
  /** ends a subscription now rather than at its period's end */
  cancelNow(subscriptionId: string): Promise<void>;
  /** refunds a payment in full */
  refundPayment(paymentId: string, reason: string): Promise<void>;
  changePlan(input: ChangePlanInput): Promise<void>;
  /** moves a live subscription's next renewal (dodo: PATCH next_billing_date, future dates only); nothing is charged or credited */
  setNextBillingDate?(subscriptionId: string, at: number): Promise<void>;
  /** puts a one-use discount on a live subscription's coming renewals; resolves with the provider's discount code */
  applyDiscount(input: ApplyDiscountInput): Promise<{ code: string }>;
  /** a url the owner's browser may open for this payment's invoice */
  invoiceUrl(paymentId: string): Promise<string | null>;
  invoicePdf(paymentId: string): Promise<{ contentType: string; body: Buffer } | null>;
  /** one page (SYNC_PAGE) of the provider's past records, newest first, for the owner's backfill; absent where the
   *  provider keeps no history to read */
  list?(resource: ProviderResource, page: number): Promise<Array<Record<string, unknown>>>;
}
export type ProviderResource = "payments" | "subscriptions" | "refunds" | "disputes";

export class BillingProviderError extends Error {
  code: "bad_signature" | "unavailable" | "refused";
  constructor(code: "bad_signature" | "unavailable" | "refused", message: string = code) { super(message); this.code = code; }
}

/** the account behind a request: dashboard cookie or app bearer token. swapped for shared/account-api.ts once it lands. */
export interface AccountRef { id: string; email: string }
export interface AccountResolver {
  /** the dashboard's signed-in account (HttpOnly cookie), or null. gets the whole request so the accounts service can
   * also enforce its csrf header on POST, PATCH and DELETE. */
  fromCookie(req: IncomingMessage): AccountRef | null | Promise<AccountRef | null>;
  /** the app's signed-in account (Authorization: Bearer omc_...), or null */
  fromBearer(req: IncomingMessage): AccountRef | null | Promise<AccountRef | null>;
}
/** records per backfill page: 50 dodo payments stay under the provider client's 256 KB response cap */
export const SYNC_PAGE = 50;
