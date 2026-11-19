import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { CSRF_HEADER, readCsrfCookie } from "../../../../shared/account-api";
import { lowercase } from "../lib/api";

/** what the signed-in admin may open: the owner everything, a growth admin the analytics and revenue reads */
export type AdminRole = "owner" | "growth";
export const AdminRoleContext = createContext<AdminRole>("owner");
export const useAdminRole = () => useContext(AdminRoleContext);

export class AdminApiError extends Error {
  readonly status: number; readonly code: string | null;
  constructor(message: string, status: number, code: string | null) { super(message); this.status = status; this.code = code; }
}

let fetchedCsrf: string | null = null;
/** the CSRF cookie, or the token the account read hands out when the cookie is missing */
async function csrf() {
  const raw = readCsrfCookie(document.cookie) ?? "";
  try { if (raw) return decodeURIComponent(raw); } catch { return raw; }
  if (fetchedCsrf) return fetchedCsrf;
  const me = await fetch("/v1/me", { credentials: "same-origin" }).then((res) => res.json() as Promise<{ csrfToken?: string }>).catch(() => null);
  fetchedCsrf = me?.csrfToken ?? null;
  return fetchedCsrf ?? "";
}

/** which analytics the panel reads when the service has a live site's too (preview reading dusk.bot): "live" or "own" */
const DATA_KEY = "dusk-admin-data";
export function adminData(): "live" | "own" {
  try { return localStorage.getItem(DATA_KEY) === "own" ? "own" : "live"; } catch { return "live"; }
}
export function setAdminData(value: "live" | "own") {
  try { if (value === "own") localStorage.setItem(DATA_KEY, "own"); else localStorage.removeItem(DATA_KEY); } catch { /* private mode keeps the default */ }
}

/** whether the panel includes the QA and review accounts the server leaves out by default */
const TESTS_KEY = "dusk-admin-tests";
export function adminTests(): boolean {
  try { return localStorage.getItem(TESTS_KEY) === "show"; } catch { return false; }
}
export function setAdminTests(show: boolean) {
  try { if (show) localStorage.setItem(TESTS_KEY, "show"); else localStorage.removeItem(TESTS_KEY); } catch { /* private mode keeps the default */ }
}

/** which money every number counts: live (the default), test (dodo test mode) or both; the revenue page's switch shares it */
export const MONEY_KEY = "dusk-admin-money";
export function adminMoney(): "live" | "test" | "all" {
  try { const v = localStorage.getItem(MONEY_KEY); return v === "test" || v === "all" ? v : "live"; } catch { return "live"; }
}

export async function adminCall<T>(path: string, init: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  const method = init.method ?? (init.body === undefined ? "GET" : "POST");
  let res: Response;
  try {
    res = await fetch(`/v1/admin${path}`, { method, credentials: "same-origin", signal: init.signal,
      headers: { accept: "application/json", ...(adminData() === "own" ? { "x-dusk-admin-data": "own" } : {}), ...(adminTests() ? { "x-dusk-admin-tests": "show" } : {}), ...(adminMoney() === "live" ? {} : { "x-dusk-admin-money": adminMoney() }), ...(init.body === undefined ? {} : { "content-type": "application/json" }), ...(method === "GET" ? {} : { [CSRF_HEADER]: await csrf() }) },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }) });
  } catch (error) {
    if ((error as Error).name === "AbortError") throw error;
    throw new AdminApiError("can't reach the account service. check your connection.", 0, "offline");
  }
  const data = await res.json().catch(() => null) as (T & { error?: string; code?: string }) | null;
  if (!res.ok) throw new AdminApiError(lowercase(data?.error) ?? "the request failed.", res.status, data?.code ?? null);
  return data as T;
}

/** one admin read: loading, its error, and a reload; an older answer never lands on a newer key */
export function useAdmin<T>(path: string | null, refreshMs?: number) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<AdminApiError | null>(null);
  const [loading, setLoading] = useState(path !== null);
  const [tick, setTick] = useState(0);
  const current = useRef(path);
  current.current = path;
  useEffect(() => {
    if (path === null) return;
    const controller = new AbortController();
    setLoading(true);
    adminCall<T>(path, { signal: controller.signal })
      .then((answer) => { if (current.current === path) { setData(answer); setError(null); } })
      .catch((err: unknown) => { if ((err as Error).name !== "AbortError" && current.current === path) setError(err instanceof AdminApiError ? err : new AdminApiError("the request failed.", 0, null)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [path, tick]);
  useEffect(() => {
    if (!refreshMs) return;
    const timer = setInterval(() => { if (document.visibilityState === "visible") setTick((n) => n + 1); }, refreshMs);
    return () => clearInterval(timer);
  }, [refreshMs]);
  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { data, error, loading, reload, setData };
}

export interface FunnelStep { id: string; label: string; count: number; total: number }
export interface Overview {
  now: number; days: number; range: string[];
  totals: { accounts: number; newAccounts: number; activeToday: number; wau: number; mau: number; paying: number; waitlist: number | null; clouds: number; devices: number };
  series: { signups: number[]; waitlist: number[]; active: number[]; visitors: number[]; views: number[]; apps: number[] };
  funnel: FunnelStep[];
  clouds: Array<{ state: string; count: number }>;
  bots: { workspaces: number; bots: number; turns30d: number };
  platforms: Array<{ platform: string; count: number }>;
  spend: { exposed: boolean; note: string };
}
export interface UserRow {
  id: string; email: string; name: string | null; createdAt: number; methods: string[]; plan: { plan: string | null; status: string } | null;
  clouds: number; devices: number; platforms: string[]; lastSeenAt: number | null; optOut: boolean;
}
export interface CloudRow {
  id: string; name: string; accountId: string; owner: string | null; kind: string; plan: string; placement: string; region: string; regionLabel: string; status: string;
  setupStep: string | null; backend: string | null; origin: string | null; spec: { vcpu: number; ramGb: number; diskGb: number }; createdAt: number; provisionedAt: number | null;
  powerSince: number; lastReportAt: number | null; suspended: boolean; ended: boolean; destroyAt: number | null; error: string | null;
  subscription: { status: string; periodEnd: number | null } | null; actions: { pause: boolean; resume: boolean; delete: boolean; endTrial?: boolean };
  /** internet upload this month and what the egress guard did (managed clouds) */
  egress: { bytes: number; state: "ok" | "slowed" | "paused" } | null;
}
export interface TimelineItem { name: string; at: number; props: Record<string, string | number | boolean>; source: "event" | "record" }
export interface UserDetail {
  account: { id: string; email: string; name: string | null; createdAt: number; lastSeenAt: number | null; optOut: boolean;
    /** absent from an older service */
    admin?: { owner: boolean; role: Exclude<AdminRole, "owner"> | null } };
  methods: string[]; plan: UserRow["plan"];
  subscriptions: PlanSubscription[];
  payments: Array<{ id: string; amountCents: number; currency: string; status: string; createdAt: number; description?: string; mode?: "test" | "live" }>;
  devices: Array<{ id: string; kind: string; name: string; platform: string | null; appVersion: string | null; createdAt: number; lastSeenAt: number }>;
  clouds: CloudRow[];
  workspaces: Array<{ id: string; name: string; kind: string; version: string; connectedAt: number; lastReportAt: number | null; bots: number; turns30d: number; computers: number }>;
  timeline: TimelineItem[];
  billing: { grants: boolean; provider: "preview" | "fake" | "dodo" | "off"; mode?: "test" | "live"; plans: Array<{ id: string; label: string; monthlyCents: number }> };
  audit: AuditEntry[];
}
export interface PlanSubscription {
  id: string; plan: string | null; bundle: string | null; interval: "month" | "year"; status: "pending" | "active" | "payment_problem" | "cancelled" | "ended"; totalCents: number;
  periodStart: number | null; periodEnd: number | null; openEnded: boolean; cancelAtPeriodEnd: boolean; cloudId: string | null; source: string | null; comp: boolean; createdAt: number;
  mode?: "test" | "live";
  /** dodo bills it, so its length moves at dodo */
  dodo?: boolean;
}
export type PlanChange =
  | { action: "grant"; plan: string; until: number | null }
  | { action: "change"; plan: string; subscription: string }
  | { action: "interval"; interval: "month" | "year"; subscription: string }
  | { action: "set_end"; until: number | null; subscription: string }
  | { action: "cancel"; when: "now" | "period_end"; subscription: string }
  | { action: "keep"; subscription: string }
  | { action: "note"; text: string };
/** what a plan-length change will do, from the server, before it is made */
export interface PlanPreview { action: "interval" | "set_end"; subscription: string; before: string; after: string; chargeNowCents: number | null; effects: string[] }
export interface EventRow { id: string; name: string; at: number; accountId: string | null; email: string | null; props: Record<string, string | number | boolean>; ctx?: Record<string, unknown> }
export interface WaitlistPage {
  configured: boolean; count?: number; total: number; offset?: number; limit?: number;
  entries: Array<{ email: string; position: number; createdAt: number; source: string | null; ref: string | null }>;
  days?: string[]; series?: number[];
  brevo: { state: "not_configured" | "synced" | "behind" | "error"; listCount: number | null; waitlistCount: number | null; checkedAt: number | null };
}
export interface Health {
  now: number;
  service: { version: string | null; environment: string; startedAt: number; uptimeSec: number; node: string; rssMb: number };
  database: { ok: boolean; detail: string };
  analytics: { ok: boolean; detail: string; latencyMs: number | null; written: number; failed: number; dropped: number; lastFailureAt: number | null };
  backup: { configured: boolean; at: number | null; ageHours: number | null; ok: boolean | null };
  errors: { service: { hour: number; day: number; sinceStart: number }; page: { hour: number; day: number; sinceStart: number }; spooled: number };
  checks: Array<{ name: string; url: string; ok: boolean; status: number | null; latencyMs: number | null }>;
}
export interface AuditEntry { id: string; at: number; actor: string; actorEmail: string | null; action: string; target: string | null; detail: Record<string, string | number | boolean | null> }
