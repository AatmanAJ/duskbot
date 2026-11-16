import { BillingProviderError, SYNC_PAGE } from "./types.ts";
import type { BillingProvider } from "./types.ts";
import { verifyWebhook } from "./webhook-signature.ts";

export interface DodoProviderOptions {
  apiKey: string; webhookSecret: string; mode: "test" | "live"; fetch?: typeof fetch; now?: () => number;
  /** loopback http only, for isolated provider fixtures */
  baseUrl?: string;
}
export function createDodoProvider(options: DodoProviderOptions): BillingProvider {
  const base = options.baseUrl ?? `https://${options.mode}.dodopayments.com`;
  if (options.baseUrl) {
    const url = new URL(base);
    if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new BillingProviderError("refused");
  }
  const requestFetch = options.fetch ?? fetch, now = options.now ?? Date.now;
  async function request(path: string, method: string, body?: unknown, pdf = false): Promise<{ contentType: string; body: Buffer } | null> {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await requestFetch(`${base.replace(/\/$/, "")}${path}`, { method, redirect: "error", signal: controller.signal,
        headers: { authorization: `Bearer ${options.apiKey}`, "content-type": "application/json", accept: pdf ? "application/pdf" : "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      if (pdf && response.status === 404) { await response.body?.cancel(); return null; }
      if (!response.ok) { await response.body?.cancel(); throw new BillingProviderError(response.status >= 500 ? "unavailable" : "refused"); }
      const cap = pdf ? 5 * 1024 * 1024 : 256 * 1024;
      if (Number(response.headers.get("content-length")) > cap) { await response.body?.cancel(); throw new BillingProviderError("refused"); }
      const chunks: Uint8Array[] = []; let size = 0;
      if (response.body) {
        const reader = response.body.getReader();
        try {
          while (true) {
            const chunk = await reader.read(); if (chunk.done) break;
            size += chunk.value.length;
            if (size > cap) { await reader.cancel(); throw new BillingProviderError("refused"); }
            chunks.push(chunk.value);
          }
        } finally { reader.releaseLock(); }
      }
      const contentType = response.headers.get("content-type")?.split(";")[0].trim() ?? "application/octet-stream";
      if (pdf && contentType !== "application/pdf") throw new BillingProviderError("refused");
      return { contentType, body: Buffer.concat(chunks) };
    } catch (error) { if (error instanceof BillingProviderError) throw error; throw new BillingProviderError("unavailable"); }
    finally { clearTimeout(timer); }
  }
  async function json(path: string, body?: unknown) {
    const result = await request(path, "POST", body);
    try {
      const data: unknown = JSON.parse(result!.body.toString("utf8"));
      if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error();
      return data as Record<string, unknown>;
    } catch { throw new BillingProviderError("refused"); }
  }
  function allowedUrl(value: unknown, host: string) {
    try {
      if (typeof value !== "string") throw new Error();
      const url = new URL(value);
      if (url.protocol !== "https:" || url.hostname !== host || url.port || url.username || url.password) throw new Error();
      return url.href;
    } catch { throw new BillingProviderError("refused"); }
  }
  const prefix = options.mode === "test" ? "test." : "";
  return {
    name: "dodo",
    async createCheckout(input) {
      const name = input.customerId ? null : checkoutName(input.name, input.email);
      const body = (named: boolean) => ({ product_cart: input.cart.map(line => ({ product_id: line.productId, quantity: line.quantity,
        ...(line.addons.length ? { addons: line.addons.map(addon => ({ addon_id: addon.addonId, quantity: addon.quantity })) } : {}) })),
        customer: input.customerId ? { customer_id: input.customerId } : { email: input.email, ...(named && name ? { name } : {}) }, return_url: input.returnUrl, metadata: { checkoutId: input.checkoutId, accountId: input.accountId },
        ...(input.trialDays ? { subscription_data: { trial_period_days: input.trialDays } } : {}) });
      // the name only saves typing: a checkout dodo refuses with it is asked once more without it
      const result = await json("/checkouts", body(true)).catch((error: unknown) => {
        if (!name || !(error instanceof BillingProviderError) || error.code !== "refused") throw error;
        return json("/checkouts", body(false));
      });
      if (typeof result.session_id !== "string" || !result.session_id) throw new BillingProviderError("refused");
      return { sessionId: result.session_id, url: allowedUrl(result.checkout_url, `${prefix}checkout.dodopayments.com`) };
    },
    async updatePaymentMethod(subscriptionId, returnUrl) {
      const result = await json(`/subscriptions/${encodeURIComponent(subscriptionId)}/update-payment-method`, { type: "new", return_url: returnUrl });
      return { url: allowedUrl(result.payment_link, `${prefix}checkout.dodopayments.com`) };
    },
    verifyWebhook: (headers, body) => verifyWebhook(options.webhookSecret, headers, body, now()),
    async cancelAtPeriodEnd(id, cancel) { await request(`/subscriptions/${encodeURIComponent(id)}`, "PATCH", { cancel_at_next_billing_date: cancel }); },
    async cancelNow(id) { await request(`/subscriptions/${encodeURIComponent(id)}`, "PATCH", { status: "cancelled" }); },
    async setNextBillingDate(id, at) { await request(`/subscriptions/${encodeURIComponent(id)}`, "PATCH", { next_billing_date: new Date(at).toISOString() }); },
    async refundPayment(paymentId, reason) { await request("/refunds", "POST", { payment_id: paymentId, reason }); },
    async changePlan(input) { await request(`/subscriptions/${encodeURIComponent(input.subscriptionId)}/change-plan`, "POST", { product_id: input.productId, quantity: 1, proration_billing_mode: "difference_immediately", on_payment_failure: "prevent_change", addons: input.addons.map(addon => ({ addon_id: addon.addonId, quantity: addon.quantity })) }); },
    // dodo (2026-11) has no discount field on PATCH /subscriptions; change-plan takes discount_codes, so the same
    // product and addons are sent again with the code, unbilled, from the next billing date
    async applyDiscount(input) {
      const discount = await json("/discounts", { type: "percentage", amount: input.percent * 100, subscription_cycles: input.cycles, usage_limit: 1, per_customer_usage_limit: 1,
        preserve_on_plan_change: true, name: "stay on dusk bot", metadata: { accountId: input.accountId, kind: "retention" } });
      if (typeof discount.code !== "string" || !discount.code) throw new BillingProviderError("refused");
      await request(`/subscriptions/${encodeURIComponent(input.subscriptionId)}/change-plan`, "POST", { product_id: input.productId, quantity: 1, proration_billing_mode: "do_not_bill",
        effective_at: "next_billing_date", addons: input.addons.map(addon => ({ addon_id: addon.addonId, quantity: addon.quantity })), discount_codes: [discount.code] });
      return { code: discount.code };
    },
    async invoiceUrl() { return null; },
    invoicePdf: id => request(`/invoices/payments/${encodeURIComponent(id)}`, "GET", undefined, true),
    async list(resource, page) {
      const result = await request(`/${resource}?page_size=${SYNC_PAGE}&page_number=${page}`, "GET");
      try {
        const data: unknown = JSON.parse(result!.body.toString("utf8"));
        const items = data && typeof data === "object" ? (data as { items?: unknown }).items : null;
        if (!Array.isArray(items)) throw new Error();
        return items.filter((item): item is Record<string, unknown> => !!item && typeof item === "object" && !Array.isArray(item));
      } catch { throw new BillingProviderError("refused"); }
    },
  };
}

/** the name dodo's checkout shows filled in: the account's own, else a guess from the email ("jane.doe+x@" is "Jane Doe");
 *  nothing when neither reads as a name */
export function checkoutName(own: string | null | undefined, email: string): string | null {
  const clean = (value: string) => value.replace(/[\p{C}<>"]/gu, "").replace(/\s+/g, " ").trim().slice(0, 60);
  const given = own ? clean(own) : "";
  if (/\p{L}/u.test(given)) return given;
  const local = (email.split("@")[0] ?? "").split("+")[0]!;
  const words = local.split(/[._\-\s]+/).map(word => word.replace(/[^\p{L}]/gu, "")).filter(word => word.length > 1);
  const guess = clean(words.map(word => word[0]!.toUpperCase() + word.slice(1).toLowerCase()).join(" "));
  return guess.length >= 2 ? guess : null;
}
