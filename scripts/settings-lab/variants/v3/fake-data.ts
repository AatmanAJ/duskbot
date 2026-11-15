// what the fake server knows: one person's desktop app with Claude and ChatGPT signed in. invented, never real accounts.
import type { ConfigStatus, InstanceInfo } from "@/state/store";
import type { Route } from "./fake-server";
import { MODEL_PROVIDERS } from "../../../../shared/model-providers";
import type { LoginSummary, OnePasswordStatus } from "../../../../shared/logins";
import type { SavedSecretSummary } from "../../../../shared/saved-secrets";
import type { EngineLimitsReport } from "../../../../shared/limit-reset";
import type { BatteryReport, DailyUsageReport } from "../../../../shared/spend";

export const FAKE_CONFIG: ConfigStatus = {
  composio: { configured: true, mode: "managed" },
  box: { configured: false },
  vps: { configured: false, sshAlias: "" },
  rooms: { turnTimeoutMinutes: 10 },
  localVm: { mode: "shared", maxInstances: 2 },
  profile: { name: "Sidd", email: "sidd@example.com", aboutMe: "Based in Bengaluru. Likes short answers and window seats." },
  language: "",
  talkingStyle: "warm" as ConfigStatus["talkingStyle"],
  features: { skillAuthoring: true, quickUpdates: true, skillsLibrary: true, browser: true },
  browserEngine: { kind: "engine", version: "1.4.2", chrome: "Google Chrome 153 (installed)", myChrome: true },
  browserProfiles: [{ id: "work", name: "Work" }],
  tts: { configured: true, ready: true, voice: "Aria", provider: "system", listen: { ready: true, provider: "This Mac" } },
  onboarding: { completedAt: new Date(Date.now() - 86_400_000 * 30).toISOString(), version: 9, reelSeen: true, hintsSeen: [] },
  anthropic: { configured: false },
  openai: { configured: true, last4: "9f2c" },
  openrouter: { configured: false },
};

const model = (id: string, label: string) => ({ id, label });

export const FAKE_INSTANCES: InstanceInfo[] = [
  {
    instanceId: "claude", driverKind: "claudeAgent", displayName: "Claude", cliDefault: "claude", access: "subscription",
    snapshot: { state: "available", authenticated: true, account: { email: "sidd@example.com", method: "login" }, version: "2.4.1", billing: "subscription" },
    models: { default: "sonnet", options: [model("opus", "Opus 5.5"), model("sonnet", "Sonnet 5"), model("haiku", "Haiku 5")] },
    authentication: { method: "browser", signOut: true },
  },
  {
    instanceId: "chatgpt", driverKind: "codex", displayName: "ChatGPT", cliDefault: "codex", access: "subscription",
    snapshot: { state: "available", authenticated: true, chatgptPlan: true, account: { email: "sidd@example.com", method: "login" }, version: "0.98.0", billing: "subscription" },
    models: { default: "gpt-5.5", options: [model("gpt-5.5", "GPT-5.5"), model("gpt-5.5-mini", "GPT-5.5 mini")] },
    authentication: { method: "device-code", signOut: true },
  },
  {
    instanceId: "antigravity", driverKind: "antigravityAgent", displayName: "Antigravity", cliDefault: "agy_acp_server",
    snapshot: { state: "available", authenticated: false },
    models: { default: "gemini-3-pro", options: [model("gemini-3-pro", "Gemini 3 Pro")] },
    authentication: { method: "browser" },
  },
];

const DAY = 86_400_000;
const now = Date.now();

const LOGINS: LoginSummary[] = [
  { id: "l1", site: "github.com", hosts: ["github.com"], exactHost: false, username: "sidd", hasTotp: true, source: "settings", bots: "all", createdAt: now - 40 * DAY, lastUsedAt: now - 2 * DAY },
  { id: "l2", site: "notion.so", hosts: ["www.notion.so"], exactHost: false, username: "sidd@example.com", hasTotp: false, source: "card", bots: "all", createdAt: now - 12 * DAY },
  { id: "l3", site: "figma.com", hosts: ["www.figma.com"], exactHost: false, username: "sidd@example.com", hasTotp: false, source: "settings", bots: "all", createdAt: now - 5 * DAY, lastUsedAt: now - DAY },
];
const SECRETS: SavedSecretSummary[] = [
  { id: "s1", label: "Stripe test key", bots: [], createdAt: now - 20 * DAY, updatedAt: now - 20 * DAY },
];

const BOTS = [["nova", "Nova"], ["quill", "Quill"], ["rivet", "Rivet"], ["tally", "Tally"]] as const;
const battery = (): BatteryReport => {
  const usd = [4.12, 2.38, 1.06, 0.44];
  const total = usd.reduce((sum, value) => sum + value, 0);
  return {
    from: new Date(now - 7 * DAY).toISOString(), to: new Date(now).toISOString(), basis: "usd", totalUsd: total, totalTokens: 1_820_000,
    rows: BOTS.map(([id, name], index) => ({ kind: "bot", id, name, usd: usd[index]!, tokens: Math.round(usd[index]! * 220_000), share: usd[index]! / total })),
  };
};
const daily = (days: number): DailyUsageReport => {
  const dates = Array.from({ length: days }, (_, index) => new Date(now - (days - 1 - index) * DAY).toISOString().slice(0, 10));
  const wave = (seed: number) => dates.map((_, index) => Math.round((0.3 + 0.7 * Math.abs(Math.sin(index * 0.9 + seed))) * 100) / 100);
  const series = BOTS.slice(0, 3).map(([id, name], index) => {
    const values = wave(index * 1.7).map((value) => Math.round(value * (1.2 - index * 0.3) * 100) / 100);
    return { key: id, botId: id, name, values, total: values.reduce((sum, value) => sum + value, 0) };
  });
  const totals = dates.map((_, index) => series.reduce((sum, entry) => sum + entry.values[index]!, 0));
  return { days: dates, basis: "usd", total: totals.reduce((sum, value) => sum + value, 0), totals, series };
};
const limits = (): EngineLimitsReport => ({
  checkedAt: now,
  engines: [
    { engine: "claude", name: "Claude", driver: "claude", window: "5-hour", usedPercent: 38, resetsAt: now + 2.5 * 3_600_000, blocked: false,
      windows: [{ window: "5-hour", usedPercent: 38, resetsAt: now + 2.5 * 3_600_000 }, { window: "weekly", usedPercent: 21, resetsAt: now + 4 * DAY }] },
    { engine: "chatgpt", name: "ChatGPT", driver: "codex", window: "weekly", usedPercent: 12, resetsAt: now + 6 * DAY, blocked: false,
      windows: [{ window: "5-hour", usedPercent: 4, resetsAt: now + 4 * 3_600_000 }, { window: "weekly", usedPercent: 12, resetsAt: now + 6 * DAY }] },
  ],
});

type Server = { config: ConfigStatus; instances: InstanceInfo[]; changed: () => void };

let help = true;
let attachments = 186 * 1024 ** 2;
let logins = LOGINS;
let secrets = SECRETS;
const onePassword: OnePasswordStatus = { connected: false };

export function fakeRoutes(server: Server): Route[] {
  const config = (patch: unknown) => {
    server.config = mergeConfig(server.config, patch);
    server.changed();
    return server.config as unknown as Record<string, unknown>;
  };
  return [
    { method: "GET", path: /^\/api\/auth\/session$/, answer: () => ({ kind: "loopback" }) },
    { method: "GET", path: /^\/api\/config$/, answer: () => server.config as unknown as Record<string, unknown> },
    { method: "PATCH", path: /^\/api\/config$/, answer: (_, body) => config(body) },
    { method: "PUT", path: /^\/api\/config$/, answer: (_, body) => config(body) },
    { method: "GET", path: /^\/api\/instances$/, answer: () => ({ instances: server.instances }) },
    { method: "GET", path: /^\/api\/dashboard\/usage-signals$/, answer: () => ({ enabled: help }) },
    { method: "PUT", path: /^\/api\/dashboard\/usage-signals$/, answer: (_, body) => ({ enabled: (help = Boolean(body?.enabled)) }) },
    { method: "GET", path: /^\/api\/logins$/, answer: () => ({ logins, onePassword }) },
    { method: "DELETE", path: /^\/api\/logins\/([^/]+)$/, answer: (match) => { logins = logins.filter((login) => login.id !== match[1]); return { ok: true }; } },
    { method: "GET", path: /^\/api\/saved-secrets$/, answer: () => ({ secrets }) },
    { method: "DELETE", path: /^\/api\/saved-secrets\/([^/]+)$/, answer: (match) => { secrets = secrets.filter((secret) => secret.id !== match[1]); return { ok: true }; } },
    { method: "GET", path: /^\/api\/model-providers$/, answer: () => ({
      place: "computer",
      catalog: { origin: "models.dev", updatedAt: new Date(now - DAY).toISOString(), providers: MODEL_PROVIDERS.length, models: 412 },
      providers: MODEL_PROVIDERS.map(({ hosts: _h, instances: _i, driverKinds: _d, words: _w, ...def }) => ({
        ...def, offered: true, modelCount: def.id === "openai" ? 24 : def.id === "anthropic" ? 9 : 6,
        connected: def.id === "openai" ? ["openai"] : [],
      })),
      more: [],
    }) },
    { method: "GET", path: /^\/api\/bot-defaults$/, answer: () => ({
      defaults: { profile: { modelSelection: { instanceId: "claude", model: "sonnet" } }, memory: {}, skills: [], routines: [] },
      modelSelection: { instanceId: "claude", model: "sonnet" },
      suggestedName: "Nova",
    }) },
    { method: "GET", path: /^\/api\/usage\/battery$/, answer: () => battery() as unknown as Record<string, unknown> },
    { method: "GET", path: /^\/api\/usage\/daily$/, answer: (_, __, url) => daily(Number(url.searchParams.get("days")) || 7) as unknown as Record<string, unknown> },
    { method: "GET", path: /^\/api\/profile\/learned$/, answer: () => ({ learned: [] }) },
    { method: "GET", path: /^\/api\/profile\/general$/, answer: () => ({ history: [] }) },
    { method: "GET", path: /^\/api\/mcp\/servers$/, answer: () => ({ servers: [] }) },
    { method: "GET", path: /^\/api\/auth\/sessions$/, answer: () => ({ sessions: [] }) },
    { method: "GET", path: /^\/api\/slack\/workspace$/, answer: () => ({ version: 1, state: "not_connected", apps: 0, ready: true }) },
    { method: "GET", path: /^\/api\/attachment-storage$/, answer: () => ({ usedBytes: attachments, maxBytes: 2 * 1024 ** 3 }) },
    { method: "POST", path: /^\/api\/attachment-storage$/, answer: () => {
      const freed = attachments;
      attachments = 0;
      return { usedBytes: 0, maxBytes: 2 * 1024 ** 3, removed: 38, freedBytes: freed, failed: 0 };
    } },
    { method: "GET", path: /^\/api\/workspace-backup\/status$/, answer: () => ({ busy: false }) },
    { method: "GET", path: /^\/api\/skills-library$/, answer: () => ({ skills: [] }) },
    { method: "GET", path: /^\/api\/plan-usage$/, answer: () => ({ fetchedAt: new Date(now).toISOString(), providers: [] }) },
    { method: "GET", path: /^\/api\/usage$/, answer: (_, __, url) => {
      const groupBy = url.searchParams.get("groupBy") ?? "bot";
      return {
        groupBy,
        groups: BOTS.map(([id, name], index) => ({
          key: groupBy === "bot" ? `bot:${id}` : `${groupBy}:${id}`, label: groupBy === "model" ? ["sonnet", "gpt-5.5", "opus", "haiku"][index]! : name,
          turns: 40 - index * 9, input: 620_000 - index * 140_000, output: 88_000 - index * 20_000, cachedInput: 410_000 - index * 90_000, costUsd: [4.12, 2.38, 1.06, 0.44][index]!,
        })),
      };
    } },
    { method: "GET", path: /^\/api\/usage\/traces$/, answer: (_, __, url) => ({
      from: url.searchParams.get("from"), to: url.searchParams.get("to"), roots: [],
      totals: { durationMs: 0, costUsd: 0, tokens: 0, input: 0, cachedInput: 0, output: 0, steps: 0, tools: 0, errors: 0 },
    }) },
    { method: "GET", path: /^\/api\/local-computer$/, answer: () => ({
      platform: "darwin", runtime: "docker", available: ["docker"], daemonUp: true, image: true, imageMatches: true, managed: true, container: "stopped",
      network: "loopback", security: "hardened", persistence: "durable", desktopReady: true, ready: true, problem: null,
      image_ref: "dusk/desktop:1.42.0", base_image_ref: "dusk/desktop-base:1.42.0", driver_version: "1.42.0", container_name: "dusk-desktop",
      workspace_path: "~/.duskbot/desktop", workspace_guest_path: "/home/dusk",
    }) },
    { method: "GET", path: /^\/api\/local-computer\/instances$/, answer: () => ({ available: true, instances: [], maxInstances: 2 }) },
    { method: "GET", path: /^\/api\/computers\/vps$/, answer: () => ({ available: false, configured: false, instances: [], vpsAliases: [] }) },
    { method: "GET", path: /^\/api\/mac$/, answer: () => ({ available: false }) },
    { method: "GET", path: /^\/api\/computer\/egress$/, answer: () => ({ available: false }) },
    { method: "GET", path: /^\/api\/limit-resets$/, answer: () => limits() as unknown as Record<string, unknown> },
  ];
}

function mergeConfig(base: ConfigStatus, patch: unknown): ConfigStatus {
  if (typeof patch !== "object" || !patch) return base;
  const next = structuredClone(base) as unknown as Record<string, unknown>;
  for (const [key, value] of Object.entries(patch)) {
    const current = next[key];
    next[key] = value && typeof value === "object" && !Array.isArray(value) && current && typeof current === "object" && !Array.isArray(current)
      ? { ...(current as object), ...(value as object) }
      : value;
  }
  return next as unknown as ConfigStatus;
}
