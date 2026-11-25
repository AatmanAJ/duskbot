import { useEffect, useState } from "react";
import { useAmbientAway } from "@/ambient/away";
import { emailGateDone } from "@/lib/analytics";
import { clearWelcomeDraft } from "@/lib/welcome-draft";
import { openedFromTheApp } from "@/lib/cloud-welcome";
import { LOCAL_VIEWER, useWelcomeOnScreen, welcomeDue, welcomeViewer, type WelcomeViewer } from "@/lib/onboarding";
import { PHONE_LAYOUT } from "@/lib/use-media-query";
import { api, useStore } from "@/state/store";
import { focusComposerWhenShown } from "../AskCard";
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

const welcomeDueFor = (config: Parameters<typeof welcomeDue>[0], viewer: WelcomeViewer | null) => welcomeDue(config, {
  remoteClient: window.duskDesktop?.remoteClient?.active === true,
  legacyDone: emailGateDone(),
  canSave: viewer?.canSave,
  cloudHome: viewer?.cloudHome,
  fromApp: openedFromTheApp(),
});

/** How long the window's loading cover may wait for a due welcome to arrive: a welcome that never loads uncovers the app. */
const WELCOME_HOLD_MS = 4000;

/** A welcome is due on this launch and not on screen yet, so the loading cover stays over the app until it is. */
export function useWelcomeIncoming(viewer: WelcomeViewer | null): boolean {
  const { state } = useStore();
  const shown = useWelcomeOnScreen();
  const [expired, setExpired] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setExpired(true), WELCOME_HOLD_MS);
    return () => window.clearTimeout(timer);
  }, []);
  if (expired || shown || !viewer) return false;
  return state.config === null || welcomeDueFor(state.config, viewer);
}

export function WelcomeGate({ viewer }: { viewer: WelcomeViewer | null }) {
  const { state, dispatch } = useStore();
  const [dismissed, setDismissed] = useState(false);
  // A welcome finished elsewhere (another window, an older version's record) leaves no draft behind to resume later.
  const finished = Boolean(viewer && state.config) && !welcomeDueFor(state.config, viewer);
  useEffect(() => {
    if (finished) clearWelcomeDraft();
  }, [finished]);
  const due = Boolean(viewer) && !dismissed && welcomeDueFor(state.config, viewer);
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
      cloudHome={viewer.cloudHome === true}
      onDone={(botId) => {
        setDismissed(true);
        dispatch({ type: "toggleWelcome", open: false });
        // A first run ends in the chat with the bot it chose, else its Chief; the app tour starts only from Settings.
        const target = botId ?? (replay ? null : fallback?.id);
        if (target) dispatch({ type: "select", id: target });
        // the panel opens beside the first chat only where it docks: over it, it would dim and cut the chat's first words
        if (target && !replay && panelDocks()) dispatch({ type: "toggleSettings", open: true });
        if (target) focusComposerWhenShown();
      }}
    />
  );
}
