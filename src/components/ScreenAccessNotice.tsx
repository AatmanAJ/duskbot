import { useState } from "react";
import { t } from "@/lib/i18n";
import { macPermissionsBridge } from "@/lib/mac-permissions";
import { missingMacCuaPermissions } from "@/lib/mac-cua-permissions";
import type { Bot } from "@/state/store";
import { CARD_ACTION, ChatErrorCard } from "./ChatErrorBanner";
import { useDesktopCapabilities } from "./DesktopCapabilities";
import { MacPermissionsDialog } from "./onboarding/PermissionsStep";

// closed once, it stays closed for this run of the app
const closedFor = new Set<string>();

/** True while this Mac's screen control waits for a macOS permission, in the desktop app that can ask for it. */
export function useScreenAccessMissing(): boolean {
  const { capabilities, ready } = useDesktopCapabilities();
  const local = capabilities.localComputer;
  return ready && capabilities.host?.platform === "darwin" && local?.available === false && local.reasonCode !== "remote-server" &&
    missingMacCuaPermissions(local.message).length > 0 && macPermissionsBridge() !== null;
}

/** The card's one action: the guided permissions, then a fresh look at the computer helper. */
export function ScreenAccessCard({ onDismiss }: { onDismiss: () => void }) {
  const [asking, setAsking] = useState(false);
  const bridge = macPermissionsBridge();
  const recheck = () => { void window.duskDesktop?.localControl?.retry?.().catch(() => {}); };
  return (
    <div className="mb-2 w-full px-5" data-screen-access="">
      <ChatErrorCard tone="info" icon="offline" title={t("screenAccess.title")} onDismiss={onDismiss}
        actions={bridge && <button type="button" data-screen-access-allow="" onClick={() => setAsking(true)} className={CARD_ACTION}>{t("screenAccess.allow")}</button>} />
      {asking && bridge && <MacPermissionsDialog bridge={bridge} onClose={() => { setAsking(false); recheck(); }} onAllowed={recheck}
        relaunch={typeof window.duskDesktop?.relaunch === "function" ? () => void window.duskDesktop!.relaunch!() : null} />}
    </div>
  );
}

/** Above the composer for a bot set to work on this Mac while screen control waits for macOS: the bot still chats. */
export function ScreenAccessNotice({ bot }: { bot: Pick<Bot, "id" | "computer"> }) {
  const missing = useScreenAccessMissing();
  const [, setClosed] = useState(0);
  if (!missing || bot.computer !== "local" || closedFor.has(bot.id)) return null;
  return <ScreenAccessCard onDismiss={() => { closedFor.add(bot.id); setClosed((n) => n + 1); }} />;
}
