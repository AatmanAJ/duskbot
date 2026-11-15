// today's Settings, rebuilt from the app's own pieces: the same rail, the same panes and rows (src/components), the same
// page wipe. only the frame around them is new: how the rail shows where you are, how a pane's header reads and how one
// pane hands over to the next. each refinement is one Look plus its css (refine.css, [data-refine="..."]).
import { useState, type CSSProperties, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useStore, type AppSettingsSection } from "@/state/store";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { phoneAppEnabled } from "@/lib/feature-flags";
import { vpsLinkAvailable } from "@/lib/vps-link";
import { ADVANCED_PAGES, SETTINGS_PANES, settingsLocation, type SettingsPane } from "@/lib/open-settings";
import { Icon, type IconName } from "@/components/Icon";
import { SIMPLE_BUTTONS } from "@/components/SettingsPrimitives";
import { BackButton, PanelSections, SubPageContext, WipeStack, type SubPage } from "@/components/ListRows";
import {
  AdvancedIndex, AdvancedPageView, ComputerPane, GeneralPane, ModelsPane, PermissionsPane, TextingPane, UpdatesPane, UsagePane, VaultPane,
  advancedTitle, type AdvancedPage, type Disclose, type RemoteAccessCards,
} from "@/components/SettingsPanes";
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
import { VaultNewItem } from "@/components/LoginsSettings";
import { VoiceInputSettings } from "@/components/VoiceInputSettings";
import { BotsPane } from "@/components/SettingsBots";
import { ease, dur, offset, spring } from "@lab/tokens";
import { RealStore } from "./stub";
import "@/styles/settings.css";
import "./refine.css";

export type Look = {
  id: string;
  /** plain: today's rail; chips: a coloured tile per icon; grouped: the rail in three labelled groups; bar: no fill, an accent bar */
  rail: "plain" | "chips" | "grouped" | "bar";
  /** a short line under the pane's name */
  blurb: boolean;
  /** the pane's coloured tile beside its name */
  headIcon: boolean;
  /** rise: a short fade and rise; slide: up or down by the rail's order; blur: a soft crossfade */
  swap: "rise" | "slide" | "blur";
};

/** one identity hue per pane: the same set the bots wear */
export const PANE_HUE: Record<SettingsPane, string> = {
  general: "var(--identity-blue)", voice: "var(--identity-pink)", texting: "var(--identity-green)", computer: "var(--identity-teal)",
  permissions: "var(--identity-orange)", vault: "var(--identity-yellow)", models: "var(--identity-purple)", bots: "var(--identity-coral)",
  usage: "var(--identity-green)", updates: "var(--identity-cyan)", advanced: "var(--identity-silver)",
};

const BLURB: Record<SettingsPane, string> = {
  general: "How dusk bot looks, talks and sends.",
  voice: "Speech to text on this device.",
  texting: "Text your bots from your phone.",
  computer: "Run your bots here, in dusk cloud or on a server.",
  permissions: "Who can do what, and what happened.",
  vault: "Logins and secrets your bots use without seeing them.",
  models: "The AI behind your bots and the keys they use.",
  bots: "Every bot's own settings.",
  usage: "What your bots used, and your plan.",
  updates: "Your version, help and feedback.",
  advanced: "Apps, team, storage and backups.",
};

const GROUPS: ReadonlyArray<{ label: string; panes: SettingsPane[] }> = [
  { label: "You", panes: ["general", "voice", "texting"] },
  { label: "Your bots", panes: ["computer", "permissions", "vault", "models", "bots"] },
  { label: "This app", panes: ["usage", "updates", "advanced"] },
];

export function RefinedSettings({ look }: { look: Look }) {
  return <RealStore><Refined look={look} /></RealStore>;
}

function Refined({ look }: { look: Look }) {
  const { state, dispatch } = useStore();
  const cloudHome = state.config?.cloudHome === true;
  // the lab is the app in a browser window: the same panes today's sheet offers there
  const offered: Partial<Record<AppSettingsSection, boolean>> = { transfer: vpsLinkAvailable(), desktopWorkspaces: false, organization: false, cloudAccount: false, people: !cloudHome, activity: true, botAccess: false, permissions: true };
  const has = (id: AppSettingsSection) => offered[id] ?? true;
  const panes = SETTINGS_PANES.filter((pane) => (pane.id !== "texting" || phoneAppEnabled()) && pane.sections.some(has));
  const advancedPages = ADVANCED_PAGES.filter((page) => page.sections.some(has)).map((page) => page.id);

  const [requested, setRequested] = useState<AppSettingsSection>("general");
  const at = settingsLocation(requested);
  const pane = panes.some((entry) => entry.id === at.pane) ? at.pane : "general";
  const railPanes = panes.filter((entry) => entry.rail !== false || entry.id === pane);
  const page = pane === "advanced" && at.page && advancedPages.includes(at.page) ? at.page : undefined;
  const paneEntry = SETTINGS_PANES.find((entry) => entry.id === pane)!;
  const paneKey = `${pane}:${page ?? ""}`;

  // which way the next pane moves: down the rail rises from below, up the rail drops from above
  const [order, setOrder] = useState({ pane, direction: 1 });
  if (order.pane !== pane) {
    const index = (id: SettingsPane) => railPanes.findIndex((entry) => entry.id === id);
    setOrder({ pane, direction: index(pane) >= index(order.pane) ? 1 : -1 });
  }

  const [sub, setSub] = useState<{ key: string; stack: SubPage[] }>({ key: paneKey, stack: [] });
  const stack = sub.key === paneKey ? sub.stack : [];
  const [folds, setFolds] = useState<Record<string, boolean>>({});
  const disclose: Disclose = (id) => {
    const open = folds[id] ?? false;
    return { id, open, onToggle: () => setFolds((current) => ({ ...current, [id]: !open })) };
  };
  const go = (section: AppSettingsSection) => {
    setRequested(section);
    setSub({ key: "", stack: [] });
  };

  const remoteAccess: RemoteAccessCards = {
    client: <RemoteComputerSection hideWhenUnavailable />,
    pairing: <MobilePairingCard remote={false}>{(phone) => <ServerPairingCard phone={phone} cloudHome={cloudHome} focusRequest={0} team={state.config?.team?.name} teamPhoneBlocked={null} simple />}</MobilePairingCard>,
    desktopPairing: phoneAppEnabled() || state.config?.team ? null : <ServerPairingCard phone={null} cloudHome={cloudHome} simple />,
    companion: <CompanionSection profileEmail={state.config?.profile?.email} focusRequest={0} />,
  };
  const cloudAccount = has("cloudAccount")
    ? <CloudAccountSettings linkRequest={state.appSettingsCloudLink} cloudHome={cloudHome} teamHome={state.config?.team} onSignIn={() => dispatch({ type: "openCloudAdd", source: "app_settings", signIn: true })} />
    : null;

  const renderBody = (advanced: AdvancedPage | undefined) => {
    switch (pane) {
      case "general": return <GeneralPane has={has} remoteActive={false} />;
      case "voice": return <VoiceInputSettings />;
      case "texting": return <TextingPane has={has} remoteAccess={remoteAccess} />;
      case "computer": return <ComputerPane has={has} remoteActive={false} remoteAccess={remoteAccess} servers={<ConnectedWorkspacesSettings />} transfer={has("transfer") ? <TransferSettings /> : null} />;
      case "permissions": return <PermissionsPane has={has} />;
      case "vault": return <VaultPane />;
      case "models": return <ModelsPane has={has} disclose={disclose} connections={<AdminOnly><KeysPage /><SlackWorkspaceCard /></AdminOnly>} />;
      case "bots": return <BotsPane />;
      case "usage": return <UsagePane has={has} cloudAccount={cloudAccount} />;
      case "updates": return <UpdatesPane />;
      case "advanced": return advanced
        ? <AdvancedPageView page={advanced} has={has} remoteActive={false} peopleOpen={requested === "people"} />
        : <AdvancedIndex pages={advancedPages} remoteActive={false} onOpen={(next) => go(ADVANCED_PAGES.find((entry) => entry.id === next)!.sections.find(has)!)} />;
    }
  };

  const hue = PANE_HUE[pane];
  const headingId = `refine-${look.id}-${pane}-heading`;
  const layer = (key: string, live: boolean) => {
    const { at: advanced, pages } = JSON.parse(key) as { at: AdvancedPage | null; pages: SubPage[] };
    const top = pages.at(-1);
    const nav = {
      at: top?.id,
      stack: pages,
      open: (id: string, title: string) => setSub({ key: paneKey, stack: [...pages, { id, title }] }),
      back: () => setSub({ key: paneKey, stack: pages.slice(0, -1) }),
    };
    const onBack = top ? nav.back : advanced ? () => go("advanced") : undefined;
    // the blurb and tile belong to the pane itself; a page opened inside it is named by its title alone
    const home = !top && !advanced;
    return (
      <>
        <header className="settings-pane-header" data-refine-head={home ? "pane" : "page"}>
          <div className="flex min-w-0 items-center gap-1.5">
            {onBack && <BackButton onBack={onBack} label={!top && advanced ? t("settings.advanced.back") : undefined} />}
            {look.headIcon && home && <PaneTile icon={paneEntry.icon} hue={hue} size={30} />}
            <div className="min-w-0">
              <h2 id={live ? headingId : undefined} className={cn("settings-pane-title truncate outline-none", onBack && "ps-0")}>
                {top?.title ?? (advanced ? advancedTitle(advanced) : t(paneEntry.labelKey))}
              </h2>
              {look.blurb && home && <p className="refine-blurb">{BLURB[pane]}</p>}
            </div>
          </div>
          {pane === "vault" && !top && <div data-settings-header-actions=""><VaultNewItem /></div>}
        </header>
        <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
          <div data-wipe-scroll="" className="settings-scroll">
            <div className={cn("settings-pane", SIMPLE_BUTTONS, "[&_.uppercase]:normal-case [&_.uppercase]:tracking-normal")}>
              <SubPageContext.Provider value={nav}><PanelSections className="contents">{renderBody(advanced ?? undefined)}</PanelSections></SubPageContext.Provider>
            </div>
          </div>
        </div>
      </>
    );
  };

  const item = (entry: (typeof railPanes)[number]) => {
    const current = entry.id === pane;
    return (
      <button
        key={entry.id}
        type="button"
        data-refine-nav={entry.id}
        aria-current={current ? "page" : undefined}
        aria-controls={current ? `refine-${look.id}-panel` : undefined}
        onClick={() => go(entry.sections.find(has)!)}
        className="settings-nav-item"
        style={{ "--pane-hue": PANE_HUE[entry.id] } as CSSProperties}
      >
        {/* the rail's highlight glides to the chosen pane instead of jumping */}
        {current && <motion.span layoutId={`refine-${look.id}-highlight`} className="refine-highlight" transition={spring.layout} aria-hidden="true" />}
        {look.rail === "chips" ? <PaneTile icon={entry.icon} hue={PANE_HUE[entry.id]} size={22} /> : <Icon name={entry.icon} size={15} className="refine-nav-icon" />}
        <span>{t(entry.labelKey)}</span>
      </button>
    );
  };
  const nav = (
    <nav aria-label={t("settings.grok.navAria")} className="settings-nav">
      {look.rail === "grouped"
        ? GROUPS.map((group) => {
          const entries = railPanes.filter((entry) => group.panes.includes(entry.id));
          return entries.length ? (
            <div key={group.label} className="refine-nav-group" role="group" aria-label={group.label}>
              <p className="settings-nav-label" aria-hidden="true">{group.label}</p>
              <div className="settings-nav-list">{entries.map(item)}</div>
            </div>
          ) : null;
        })
        : <div className="settings-nav-list">{railPanes.map(item)}</div>}
    </nav>
  );

  const direction = order.direction;
  const swap = SWAPS[look.swap];
  return (
    <div className="refine-host" data-refine={look.id}>
      <div className="settings-dialog" data-settings-look="simple" style={{ "--pane-hue": hue } as CSSProperties}>
        <div className="settings-layout">
          {nav}
          <section id={`refine-${look.id}-panel`} aria-labelledby={headingId} className="settings-panel">
            <AnimatePresence initial={false} mode="popLayout" custom={direction}>
              <motion.div key={pane} custom={direction} variants={swap} initial="enter" animate="center" exit="exit" className="refine-pane">
                <WipeStack at={JSON.stringify({ at: page ?? null, pages: stack })} depth={(page ? 1 : 0) + stack.length} group={pane} layer={layer} />
              </motion.div>
            </AnimatePresence>
          </section>
        </div>
      </div>
    </div>
  );
}

/** a pane's icon on a soft tile of its hue */
function PaneTile({ icon, hue, size }: { icon: IconName; hue: string; size: number }): ReactNode {
  return (
    <span className="refine-tile" aria-hidden="true" style={{ "--tile-hue": hue, width: size, height: size } as CSSProperties}>
      <Icon name={icon} size={Math.round(size * 0.6)} />
    </span>
  );
}

// a pane hands over in one short move: the old one fades fast, the new one settles with the lab's out curve.
// reduced motion (the lab's MotionConfig) keeps the fades and drops the travel.
const fadeOut = { duration: dur.exit, ease: ease.out };
const SWAPS = {
  rise: {
    enter: { opacity: 0, y: offset.swapIn },
    center: { opacity: 1, y: 0, transition: { duration: dur.swap, ease: ease.out } },
    exit: { opacity: 0, transition: fadeOut },
  },
  slide: {
    enter: (direction: number) => ({ opacity: 0, y: direction * offset.rise }),
    center: { opacity: 1, y: 0, transition: { y: spring.fade, opacity: { duration: dur.swap, ease: ease.out } } },
    exit: (direction: number) => ({ opacity: 0, y: direction * offset.swapOut, transition: fadeOut }),
  },
  blur: {
    enter: { opacity: 0, filter: `blur(${offset.blurIn}px)` },
    center: { opacity: 1, filter: "blur(0px)", transition: { duration: dur.expand, ease: ease.out } },
    exit: { opacity: 0, filter: `blur(${offset.blurOut}px)`, transition: fadeOut },
  },
};
