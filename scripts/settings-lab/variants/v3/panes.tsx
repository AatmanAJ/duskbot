// the app's settings panes, as SettingsModal draws them, one per card. same panes, same rows, same order as the rail.
import { useState, type ReactNode } from "react";
import { useStore, type AppSettingsSection } from "@/state/store";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { phoneAppEnabled } from "@/lib/feature-flags";
import { vpsLinkAvailable } from "@/lib/vps-link";
import { appVersion } from "@/lib/app-links";
import { ADVANCED_PAGES, SETTINGS_PANES, type AdvancedPage, type SettingsPane } from "@/lib/open-settings";
import type { IconName } from "@/components/Icon";
import { AdminOnly } from "@/components/AdminOnly";
import { SlackWorkspaceCard } from "@/components/slack/SlackWorkspaceCard";
import { KeysPage } from "@/components/keys/KeysPage";
import { CompanionSection } from "@/components/CompanionSection";
import { ServerPairingCard } from "@/components/ServerPairingCard";
import { MobilePairingCard } from "@/components/MobilePairingCard";
import { RemoteComputerSection } from "@/components/RemoteComputerSection";
import { ConnectedWorkspacesSettings } from "@/components/ConnectedWorkspacesSettings";
import { CloudAccountSettings } from "@/components/CloudAccountSettings";
import { TransferSettings } from "@/components/vps-link/TransferSettings";
import { SIMPLE_BUTTONS } from "@/components/SettingsPrimitives";
import { PanelSections, SubPageContext, type SubPage } from "@/components/ListRows";
import {
  AdvancedIndex, AdvancedPageView, ComputerPane, GeneralPane, ModelsPane, PermissionsPane, TextingPane, UpdatesPane, UsagePane, VaultPane,
  advancedTitle, type Disclose, type RemoteAccessCards,
} from "@/components/SettingsPanes";
import { VaultNewItem } from "@/components/LoginsSettings";
import { VoiceInputSettings } from "@/components/VoiceInputSettings";
import "@/styles/settings.css";

export type Hue = "blue" | "purple" | "teal" | "green" | "yellow" | "orange" | "pink" | "coral" | "cyan" | "silver";
export type Card = { id: SettingsPane; title: string; icon: IconName; hue: Hue };

/** a colour per pane; everything else (name, icon, order) is the app's rail */
const HUES: Record<SettingsPane, Hue> = {
  general: "blue", voice: "purple", texting: "cyan", computer: "teal", permissions: "coral", vault: "yellow",
  models: "orange", bots: "pink", usage: "green", updates: "pink", advanced: "silver",
};

/** what the desktop app offers (SettingsModal `offered`, with the desktop bridge present and no team) */
const OFFERED: Record<AppSettingsSection, boolean> = {
  general: true, appearance: true, texting: true, companion: true, remote: true, computer: true, logins: true, updates: true,
  advanced: true, apps: true, looks: true, bots: true, data: true, builder: true, about: true, engines: true, connections: true,
  skills: true, usage: true, backups: true, import: true, experimental: true, voice: true, transfer: vpsLinkAvailable(),
  desktopWorkspaces: false, organization: false, cloudAccount: true, people: false, activity: false, botAccess: false, permissions: false,
};
export const has = (id: AppSettingsSection) => OFFERED[id];

export function useCards(): Card[] {
  return SETTINGS_PANES
    .filter((pane) => pane.rail !== false && (pane.id !== "texting" || phoneAppEnabled()) && pane.sections.some(has))
    .map((pane) => ({ id: pane.id, title: t(pane.labelKey), icon: pane.icon, hue: HUES[pane.id] }));
}

export const hueVar = (hue: Hue) => `var(--identity-${hue})`;

/** one short line of live state for a card */
export function useCardValue(id: SettingsPane): string | undefined {
  const { state } = useStore();
  const config = state.config;
  switch (id) {
    case "general": return config?.profile?.name || undefined;
    case "voice": return config?.tts?.listen?.ready ? "On" : undefined;
    case "models": {
      const on = state.instances.filter((instance) => instance.snapshot.authenticated).length;
      return on ? `${on} connected` : "None yet";
    }
    case "computer": return "This Mac";
    case "updates": return appVersion();
    default: return undefined;
  }
}

/** the page a row inside a pane opened; Advanced's own pages go on the same stack as `adv:<page>` */
export type Page = SubPage;

/** one pane's body at one depth of the card's stack, wired to the app's own sub-page navigation */
export function PaneBody({ pane, pages, open, back }: {
  pane: SettingsPane;
  pages: Page[];
  open: (page: Page) => void;
  back: () => void;
}) {
  const { state, dispatch } = useStore();
  const [folds, setFolds] = useState<Record<string, boolean>>({});
  const disclose: Disclose = (id) => {
    const isOpen = folds[id] ?? false;
    return { id, open: isOpen, onToggle: () => setFolds((current) => ({ ...current, [id]: !isOpen })) };
  };
  // Advanced: the first page is one of its own pages, the rest are that page's pages
  const advanced = pane === "advanced" && pages[0]?.id.startsWith("adv:") ? (pages[0].id.slice(4) as AdvancedPage) : undefined;
  const own = advanced ? pages.slice(1) : pages;
  const nav = {
    at: own.at(-1)?.id,
    stack: own,
    open: (id: string, title: string) => open({ id, title }),
    back,
  };
  const cloudHome = state.config?.cloudHome === true;
  const remoteAccess: RemoteAccessCards = {
    client: <RemoteComputerSection hideWhenUnavailable />,
    pairing: <MobilePairingCard remote={false}>{(phone) => <ServerPairingCard phone={phone} cloudHome={cloudHome} focusRequest={0} simple />}</MobilePairingCard>,
    desktopPairing: phoneAppEnabled() ? null : <ServerPairingCard phone={null} cloudHome={cloudHome} simple />,
    companion: <CompanionSection profileEmail={state.config?.profile?.email} focusRequest={0} />,
  };
  const cloudAccount = (
    <CloudAccountSettings linkRequest={state.appSettingsCloudLink} cloudHome={cloudHome} teamHome={state.config?.team}
      onSignIn={() => dispatch({ type: "openCloudAdd", source: "app_settings", signIn: true })} />
  );
  let body: ReactNode;
  switch (pane) {
    case "general": body = <GeneralPane has={has} remoteActive={false} />; break;
    case "voice": body = <VoiceInputSettings />; break;
    case "texting": body = <TextingPane has={has} remoteAccess={remoteAccess} />; break;
    case "computer": body = <ComputerPane has={has} remoteActive={false} remoteAccess={remoteAccess} servers={<ConnectedWorkspacesSettings />} transfer={has("transfer") ? <TransferSettings /> : null} />; break;
    case "permissions": body = <PermissionsPane has={has} />; break;
    case "vault": body = <>{!nav.at && <div className="flex justify-end"><VaultNewItem /></div>}<VaultPane /></>; break;
    case "models": body = <ModelsPane has={has} disclose={disclose} connections={<AdminOnly><KeysPage /><SlackWorkspaceCard /></AdminOnly>} />; break;
    case "usage": body = <UsagePane has={has} cloudAccount={cloudAccount} />; break;
    case "updates": body = <UpdatesPane />; break;
    case "advanced": body = advanced
      ? <AdvancedPageView page={advanced} has={has} />
      : <AdvancedIndex pages={ADVANCED_PAGES.filter((page) => page.sections.some(has)).map((page) => page.id)} remoteActive={false}
        onOpen={(page) => open({ id: `adv:${page}`, title: advancedTitle(page) })} />;
      break;
    default: body = null;
  }
  return (
    <div className={cn("settings-pane v3-pane", SIMPLE_BUTTONS, "[&_.uppercase]:normal-case [&_.uppercase]:tracking-normal")}>
      <SubPageContext.Provider value={nav}><PanelSections className="contents">{body}</PanelSections></SubPageContext.Provider>
    </div>
  );
}
