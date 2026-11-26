// screenshot harness only (never committed): the phone's Settings notifications group with a fake native platform
import { createRoot } from "react-dom/client";
import { loadPageLanguage } from "@/lib/language-preference";
import { applySkinChoice, THEME_SKINS } from "@/lib/skins";
import { applyFont, readFont } from "@/lib/fonts";
import { t } from "@/lib/i18n";
import { PlatformContext, type MobilePlatform } from "@/mobile/platform";
import { SettingsRow, SettingsSection } from "@/mobile/sheets/SettingsRow";
import { NotificationSettings } from "@/mobile/sheets/NotificationSettings";
import { Bell } from "@/icons";
import "@/mobile/styles.css";
import "@/styles/overlays.css";
import "@/styles/motion.css";
import "@/mobile/mobile.css";
import "@/mobile/glass.css";
import "@/mobile/sheets/sheets.css";

const params = new URLSearchParams(location.search);
const state = params.get("state") ?? "signed-in"; // signed-in (server refuses), old-server, paired
const prefs = new Map<string, string>([
  ["dusk.mobile.connections.v1", JSON.stringify([{ id: "p1", environmentId: "env-1", label: "Ram's server", transport: "https", origin: "https://dusk.example", sessionRef: "token.p1", capabilities: {}, addedAt: 1, lastUsedAt: 1, ...(state === "paired" ? { deviceId: "dev-1" } : {}) }])],
  ["dusk.mobile.active.v1", "p1"],
]);
const platform = {
  native: true, kind: "ios", appVersion: "1.2.13", deviceName: () => "Ram's iPhone",
  registerPush: async () => ({ token: "ab".repeat(32), platform: "apns" }),
  pushPermission: async () => (state === "paired" ? "granted" : "prompt"),
  turnActivity: {},
  onResume: () => () => {},
  prefs: { get: async (k: string) => prefs.get(k) ?? null, set: async (k: string, v: string) => { prefs.set(k, v); }, remove: async (k: string) => { prefs.delete(k); } },
  secrets: { get: async () => "bearer", set: async () => {}, remove: async () => {} },
} as unknown as MobilePlatform;
window.fetch = (async (url: string, init: RequestInit = {}) => {
  const method = init.method ?? "GET";
  if (url === "/api/mobile/device" && method === "GET") return state === "paired" ? Response.json({ device: { id: "dev-1", push: "apns" } }) : Response.json(state === "old-server" ? { error: "this session is not a paired phone" } : { error: "this session is not a paired phone", code: "not_paired" }, { status: 404 });
  if (url === "/api/mobile/device" && method === "POST") return Response.json({ code: "not_adoptable" }, { status: 403 });
  if (url === "/api/mobile/push/test") return Response.json({ relay: "https://link.dusk.bot", results: [{ id: "dev-1", name: "Ram's iPhone", platform: "ios", service: "apns", outcome: "sent" }] });
  return Response.json({ ok: true });
}) as typeof fetch;

applySkinChoice(params.get("scheme") === "dark" ? THEME_SKINS.dark : THEME_SKINS.light);
applyFont(readFont());
document.documentElement.dataset.mobileApp = "ios";
void loadPageLanguage().then(() => {
  createRoot(document.getElementById("root")!).render(
    <PlatformContext value={platform}>
      <div className="dusk-mobile relative">
        <div className="min-h-screen bg-(--m-sheet-page) pt-5 pb-10">
          <div className="px-5 pb-1 text-[17px] font-semibold text-ink">{t("mobile.settings.title")}</div>
          <SettingsSection card>
            <SettingsRow icon={<Bell />} label={t("mobile.settings.notifications")} onClick={() => {}} />
            <NotificationSettings />
          </SettingsSection>
        </div>
      </div>
    </PlatformContext>,
  );
  if (params.get("tap") === "test") setTimeout(() => (document.querySelectorAll("[data-settings-row]")[1] as HTMLElement | undefined)?.click(), 600);
});
