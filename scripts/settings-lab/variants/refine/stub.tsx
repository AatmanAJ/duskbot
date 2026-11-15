// the real Settings, fed in memory: the app's own store reducer over a seeded state, and /api answered from a small
// table instead of a server. nothing here leaves the page.
import { useMemo, useReducer, type ReactNode } from "react";
import { BotEditorStore, configStatusFromFrame, initialState, reducer, type AppState, type ConfigStatus } from "@/state/store";
import { setLocale } from "@/lib/i18n";

setLocale("en");

let config: ConfigStatus = configStatusFromFrame({
  composio: { configured: true, mode: "managed" },
  box: { configured: false },
  vps: { configured: false, sshAlias: "" },
  rooms: { turnTimeoutMinutes: 10 },
  mcp: { callTimeoutMinutes: 10 },
  localVm: { mode: "shared", maxInstances: 2 },
  anthropic: { configured: true, last4: "4f2a" },
  profile: { name: "Sidd", email: "sidd@dusk.bot", aboutMe: "Based in Bengaluru. Prefers short answers and window seats." },
  language: "",
  talkingStyle: "warm",
  features: { skillAuthoring: true, quickUpdates: true, browser: true },
} as Parameters<typeof configStatusFromFrame>[0]);

/** every /api path the panes asked for, for the lab's own checks */
export const apiSeen = new Set<string>();

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

// reads the panes need a shape for; anything else answers "not here" so each screen takes its own empty or error path
const READS: Record<string, () => unknown> = {
  "/api/auth/session": () => ({ scopes: ["admin", "owner"], email: "sidd@dusk.bot", openedThreads: [] }),
  "/api/auth/sessions": () => ({ sessions: [] }),
  "/api/model-providers": () => ({
    place: "desktop",
    catalog: { origin: "models.dev", updatedAt: "2026-11-15T09:00:00Z", providers: 0, models: 0 },
    providers: [],
    more: [],
  }),
};

function answer(method: string, path: string, body: unknown): Response {
  if (path === "/api/config") {
    if (method !== "GET" && body && typeof body === "object") config = { ...config, ...(body as Partial<ConfigStatus>) };
    return json(config);
  }
  // writes succeed and echo what was sent
  if (method !== "GET") return json({ ok: true, ...(body && typeof body === "object" ? body : {}) });
  const read = READS[path];
  return read ? json(read()) : json({ error: "not in the lab" }, 404);
}

const realFetch = window.fetch.bind(window);
window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.href);
  if (url.origin !== location.origin || !url.pathname.startsWith("/api")) return realFetch(input, init);
  const method = (init?.method ?? "GET").toUpperCase();
  apiSeen.add(`${method} ${url.pathname}`);
  let body: unknown;
  try { body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined; } catch { body = undefined; }
  await new Promise((resolve) => setTimeout(resolve, 60));
  return answer(method, url.pathname, body);
};
(window as unknown as { __labApi: Set<string> }).__labApi = apiSeen;

const seeded: AppState = { ...initialState, config, connected: true, appSettingsOpen: true, appSettingsSection: "general" };

/** the app's store, in memory: the real reducer, so every row that dispatches moves the real state */
export function RealStore({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, seeded);
  const value = useMemo(() => ({
    state,
    dispatch,
    flushBotPatches: async () => null,
    refreshInstances: async () => {},
    refreshModels: async () => {},
  }), [state]);
  return <BotEditorStore value={value}>{children}</BotEditorStore>;
}
