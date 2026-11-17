import { useEffect, useState } from "react";
import { useAmbientAway } from "@/ambient/away";
import { emailGateDone } from "@/lib/analytics";
import { clearWelcomeDraft } from "@/lib/welcome-draft";
import { LOCAL_VIEWER, welcomeDue, welcomeViewer, type WelcomeViewer } from "@/lib/onboarding";
import { PHONE_LAYOUT } from "@/lib/use-media-query";
import { api, useDispatch, useStoreSelector, type AppState } from "@/state/store";
import { PANEL_DOCKS_AT } from "../PanelSlot";
import { WelcomeFlow } from "./WelcomeFlow";

/**
 * Security: a remote page the desktop app loads gets a reduced but truthy window.duskDesktop without remoteClient, and is no
 * more the owner than a browser.
 */
export function localDesktopPage(): boolean {
  return window.duskDesktop?.remoteClient !== undefined;
}

export function useWelcomeViewer(): WelcomeViewer | null {
  const local = localDesktopPage();
  const [viewer, setViewer] = useState<WelcomeViewer | null>(local ? LOCAL_VIEWER : null);
  useEffect(() => {
    if (local) return;
    let active = true;
    void api("/api/auth/session", { timeoutMs: 10_000 })
      .then((session) => {
        if (active) setViewer(welcomeViewer(session));
      })
      .catch(() => {
        if (active) setViewer(LOCAL_VIEWER);
      });
    return () => {
      active = false;
    };
  }, [local]);
  return viewer;
}

const panelDocks = () => !window.matchMedia?.(PHONE_LAYOUT).matches && window.matchMedia?.(`(min-width: ${PANEL_DOCKS_AT}px)`).matches === true;

const selectConfig = (s: AppState) => s.config;
const selectWelcomeOpen = (s: AppState) => s.welcomeOpen;
// Settings panes the welcome sends people to: API keys (Open API keys), workspaces, the organization sign-in
const selectWelcomeSettingsOpen = (s: AppState) => s.appSettingsOpen && (["desktopWorkspaces", "organization", "connections"].includes(s.appSettingsSection) ||
  (s.appSettingsSection === "cloudAccount" && s.appSettingsCloudLink > 0));
const selectFallbackBotId = (s: AppState) => (s.bots.find((b) => !b.hidden && b.chiefOfStaff) ?? s.bots.find((b) => !b.hidden))?.id;

export function WelcomeGate({ viewer }: { viewer: WelcomeViewer | null }) {
  const dispatch = useDispatch();
  const config = useStoreSelector(selectConfig);
  const welcomeOpen = useStoreSelector(selectWelcomeOpen);
  const settingsOpen = useStoreSelector(selectWelcomeSettingsOpen);
  const fallbackId = useStoreSelector(selectFallbackBotId);
  const [dismissed, setDismissed] = useState(false);
  const remoteClient = window.duskDesktop?.remoteClient?.active === true;
  // A welcome finished elsewhere (another window, an older version's record) leaves no draft behind to resume later.
  const finished = Boolean(viewer && config) && !welcomeDue(config, {
    remoteClient, legacyDone: emailGateDone(), canSave: viewer?.canSave, cloudHome: viewer?.cloudHome,
  });
  useEffect(() => {
    if (finished) clearWelcomeDraft();
  }, [finished]);
  const due =
    Boolean(viewer) &&
    !dismissed &&
    welcomeDue(config, {
      remoteClient,
      legacyDone: emailGateDone(),
      canSave: viewer?.canSave,
      cloudHome: viewer?.cloudHome,
    });
  useAmbientAway("welcome", Boolean(viewer) && (welcomeOpen || due));
  if (!viewer) return null;
  if (settingsOpen) return null;
  if (!welcomeOpen && !due) return null;
  const replay = welcomeOpen && !due;
  return (
    <WelcomeFlow
      replay={replay}
      onDone={(botId) => {
        setDismissed(true);
        dispatch({ type: "toggleWelcome", open: false });
        // A first run ends in the chat with the bot it chose, else its Chief; the app tour starts only from Settings.
        const target = botId ?? (replay ? null : fallbackId);
        if (target) dispatch({ type: "select", id: target });
        // the panel opens beside the first chat only where it docks: over it, it would dim and cut the chat's first words
        if (target && !replay && panelDocks()) dispatch({ type: "toggleSettings", open: true });
      }}
    />
  );
}
