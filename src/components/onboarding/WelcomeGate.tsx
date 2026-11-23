import { useEffect, useState } from "react";
import { useAmbientAway } from "@/ambient/away";
import { emailGateDone } from "@/lib/analytics";
import { clearWelcomeDraft } from "@/lib/welcome-draft";
import { LOCAL_VIEWER, welcomeDue, welcomeViewer, type WelcomeViewer } from "@/lib/onboarding";
import { PHONE_LAYOUT } from "@/lib/use-media-query";
import { api, useStore } from "@/state/store";
import { PANEL_DOCKS_AT } from "../PanelSlot";
import { lazyScreen } from "../lazy-screen";

export const WelcomeFlowScreen = lazyScreen("WelcomeFlow", async () => (await import("./WelcomeFlow")).WelcomeFlow);

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

export function WelcomeGate({ viewer }: { viewer: WelcomeViewer | null }) {
  const { state, dispatch } = useStore();
  const [dismissed, setDismissed] = useState(false);
  const remoteClient = window.duskDesktop?.remoteClient?.active === true;
  // A welcome finished elsewhere (another window, an older version's record) leaves no draft behind to resume later.
  const finished = Boolean(viewer && state.config) && !welcomeDue(state.config, {
    remoteClient, legacyDone: emailGateDone(), canSave: viewer?.canSave, cloudHome: viewer?.cloudHome,
  });
  useEffect(() => {
    if (finished) clearWelcomeDraft();
  }, [finished]);
  const due =
    Boolean(viewer) &&
    !dismissed &&
    welcomeDue(state.config, {
      remoteClient,
      legacyDone: emailGateDone(),
      canSave: viewer?.canSave,
      cloudHome: viewer?.cloudHome,
    });
  useAmbientAway("welcome", Boolean(viewer) && (state.welcomeOpen || due));
  if (!viewer) return null;
  // Settings panes the welcome sends people to: API keys (Open API keys), workspaces, the organization sign-in
  if (state.appSettingsOpen && (["desktopWorkspaces", "organization", "connections"].includes(state.appSettingsSection) ||
    (state.appSettingsSection === "cloudAccount" && state.appSettingsCloudLink > 0))) return null;
  if (!state.welcomeOpen && !due) return null;
  const fallback = state.bots.find((b) => !b.hidden && b.chiefOfStaff) ?? state.bots.find((b) => !b.hidden) ?? null;
  const replay = state.welcomeOpen && !due;
  return (
    <WelcomeFlowScreen
      replay={replay}
      onDone={(botId) => {
        setDismissed(true);
        dispatch({ type: "toggleWelcome", open: false });
        // A first run ends in the chat with the bot it chose, else its Chief; the app tour starts only from Settings.
        const target = botId ?? (replay ? null : fallback?.id);
        if (target) dispatch({ type: "select", id: target });
        // the panel opens beside the first chat only where it docks: over it, it would dim and cut the chat's first words
        if (target && !replay && panelDocks()) dispatch({ type: "toggleSettings", open: true });
      }}
    />
  );
}
