import { useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type ComponentType } from "react";
import { motion } from "motion/react";
import { Bell, CalendarClock, Check, ChevronRight, FileText, Globe, KeyRound, LayoutDashboard, LifeBuoy, LogOut, Mail, Mic, MoreHorizontal, Palette, Plug, Plus, ShieldCheck, Trash2, UserRound, Hand } from "../../icons";
import { accountDashboardUrl } from "@/lib/account-dashboard";
import { useGroupYou } from "@/components/GroupAvatar";
import { UserFace } from "@/components/UserAvatar";
import { trackUpsell, watchUpsell } from "@/lib/cloud-upsell";
import { t } from "@/lib/i18n";
import { effectiveLanguage, setLanguageChoice, useLanguageChoice, usePageLanguage } from "@/lib/language-preference";
import { applySkinChoice, readSkinChoice, subscribeSkin, THEME_SKINS } from "@/lib/skins";
import { localeChoices } from "@/locales";
import { useStore } from "@/state/store";
import type { MobileConnectionRecord } from "../../../shared/mobile-link";
import { useLongPress } from "../ContextMenu";
import { useConnections } from "../connection/connections";
import { haptic, setHapticsEnabled, useHapticsEnabled } from "../haptics";
import { spring } from "../motion";
import { useMobileAccount } from "../account/AccountGate";
import { LEGAL_LINKS, supportMail } from "../legal";
import { useAiConsent } from "../consent/AiConsent";
import { WorkingDots } from "@/components/WorkingIndicator";
import { SIMPLE_BUTTONS } from "@/components/SettingsPrimitives";
import { VoiceInputSettings } from "@/components/VoiceInputSettings";
import { usePlatform } from "../platform";
import { Sheet, SheetStack, StackPage } from "../Sheet";
import { NavStack } from "../NavStack";
import { NotificationsSheet } from "./NotificationsSheet";
import { RoutinesSheet } from "./RoutinesSheet";
import { ConnectorsSheet } from "./ConnectorsSheet";
import { VaultSheet } from "./VaultSheet";
import { SettingsRow, SettingsSection, SettingsSwitch } from "./SettingsRow";
import { PixelArt } from "../Illustration";
import type { SheetPageProps } from "./registry";

/** The account rows Settings shows. The account dashboard sells plans, so the store apps never link to it (App Store
 * guideline 3.1.1, Play payments policy); a signed-in account can always be signed out and deleted from here, and a
 * phone with no account (a paired computer needs none) is offered the sign-in that finds a dusk cloud. */
export function accountRows(input: { native: boolean; signedIn: boolean; offered?: boolean }): { dashboard: boolean; signOut: boolean; deleteAccount: boolean; signIn: boolean } {
  return { dashboard: !input.native, signOut: input.signedIn, deleteAccount: input.signedIn, signIn: Boolean(input.offered) && !input.signedIn };
}

/** A label a person would recognise for where these bots live: never an address like 127.0.0.1:5331 or a URL. */
export function readableWorkspace(label: string | null | undefined): string | null {
  const value = label?.trim();
  if (!value) return null;
  if (/:\/\//.test(value) || /^\[?[0-9a-f:.]+\]?(:\d+)?$/i.test(value) || /^[\w.-]+:\d+$/.test(value) || /^localhost$/i.test(value)) return null;
  return value;
}

/** The header's two lines: the person's name, then their account email, else the computer they're linked to. */
export function settingsIdentity(input: { name?: string | null; email?: string | null; workspace?: string | null }): { title: string; subtitle: string } {
  const title = input.name?.trim() || input.email?.split("@")[0] || t("mobile.settings.you");
  const subtitle = input.email?.trim() || readableWorkspace(input.workspace) || t("mobile.settings.onComputer");
  return { title, subtitle };
}

/** dusk cloud, as its own quiet card under the settings, only where the dashboard may be linked and the phone is not
 * already talking to a cloud */
function CloudCard({ onOpen }: { onOpen: () => void }) {
  const shown = useRef(false);
  useEffect(() => { if (!shown.current) { shown.current = true; trackUpsell("shown", "app_mobile"); } }, []);
  useEffect(() => watchUpsell("app_mobile"), []);
  return (
    <button type="button" onClick={() => { trackUpsell("click", "app_mobile"); onOpen(); }} className="mobile-press mx-2 mt-9 flex w-[calc(100%-16px)] items-center gap-4 rounded-[20px] bg-ink/[0.045] px-4 py-4 text-left">
      <PixelArt name="server" size={44} />
      <span className="min-w-0 flex-1">
        <span className="block text-[16px] font-semibold text-ink">{t("cloudUpsell.mobile")}</span>
        <span className="mt-0.5 block text-[14px] font-medium leading-5 text-ink-secondary">{t("cloudUpsell.mobileDetail")}</span>
      </span>
    </button>
  );
}

type SettingsPage = "account" | "language" | "voice" | "notifications" | "routines" | "connectors" | "vault";
const SETTINGS_PAGES: readonly string[] = ["account", "language", "voice", "notifications", "routines", "connectors", "vault"];

/** Settings is a stack inside one sheet, as iOS Settings: the grouped list, and each page pushed over it with the
 * system's slide and edge swipe back. Notifications, routines, apps and the vault are the same pages the rest of the
 * app opens as sheets, drawn here as pages, so nothing in Settings leaves it. */
export const SettingsSheet: ComponentType<SheetPageProps<"settings">> = ({ sheet, open, onClose, onOpenSheet, onOpenChat }) => {
  const [page, setPage] = useState<SettingsPage | null>(SETTINGS_PAGES.includes(sheet.page ?? "") ? sheet.page as SettingsPage : null);
  const pop = useCallback(() => setPage(null), []);
  const stack = useMemo(() => ({ back: pop }), [pop]);
  const pageProps = { open: true, onClose: pop, onOpenSheet, onOpenChat };
  const shown = page === "notifications" ? <NotificationsSheet sheet={{ kind: "notifications" }} {...pageProps} />
    : page === "routines" ? <RoutinesSheet sheet={{ kind: "routines" }} {...pageProps} />
    : page === "connectors" ? <ConnectorsSheet sheet={{ kind: "connectors" }} {...pageProps} />
    : page === "vault" ? <VaultSheet sheet={{ kind: "vault" }} {...pageProps} />
    : page === "language" ? <LanguagePage />
    : page === "voice" ? <Sheet open onClose={pop} title={t("settings.voice.title")}><div data-settings-look="simple" className={`flex flex-col gap-6 px-4 pt-2 ${SIMPLE_BUTTONS}`}><VoiceInputSettings /></div></Sheet>
    : page === "account" ? <AccountPage onDone={onClose} />
    : null;
  return (
    <Sheet open={open} onClose={onClose} full flush label={t("mobile.settings.title")} bodyClassName="overflow-hidden pb-0">
      <NavStack
        base={<StackPage open title={t("mobile.settings.title")} onClose={onClose}><SettingsList onClose={onClose} push={setPage} /></StackPage>}
        page={shown && <SheetStack value={stack}>{shown}</SheetStack>}
        pageKey={page}
        onBack={pop}
      />
    </Sheet>
  );
};

function SettingsList({ onClose, push }: { onClose: () => void; push: (page: SettingsPage) => void }) {
  const { state } = useStore();
  const { connections, activeId, switchTo, remove } = useConnections();
  const you = useGroupYou();
  const platform = usePlatform();
  const account = useMobileAccount();
  const hapticsEnabled = useHapticsEnabled();
  const skin = useSyncExternalStore(subscribeSkin, readSkinChoice, () => "system");
  const language = effectiveLanguage(useLanguageChoice(), state.config?.language);
  usePageLanguage(language);
  const [unlinkId, setUnlinkId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const appearanceId = useId();
  const active = connections.find((connection) => connection.id === activeId);
  const email = account?.account?.email;
  const face = account?.account ?? you?.face ?? null;
  const identity = settingsIdentity({ name: state.config?.profile?.name, email, workspace: active?.label });
  const rows = accountRows({ native: platform.native, signedIn: Boolean(email), offered: account?.offered });
  const consent = useAiConsent();
  const unread = state.notifications.filter((entry) => !entry.read).length;

  const changeWorkspace = async (id: string, unlink = false) => {
    if (busy) return;
    setBusy(true);
    setError(false);
    try {
      if (unlink) await remove(id);
      else { haptic("selection"); await switchTo(id); }
      setUnlinkId(null);
    } catch {
      haptic("error");
      setError(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="pb-6">
      <SettingsSection card>
        <button type="button" disabled={!email} onClick={() => push("account")} className="mobile-row flex w-full items-center gap-4 px-4 py-3.5 text-left disabled:pointer-events-none">
          <span className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-full bg-ink/[0.07] text-[20px] font-semibold text-ink">
            {face ? <UserFace account={face} size={56} className="size-full" /> : you?.initials ?? <UserRound aria-hidden size={24} />}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[19px] font-semibold leading-6 tracking-[-0.01em] text-ink">{identity.title}</span>
            <span data-settings-identity className="block truncate text-[14px] text-ink-secondary">{identity.subtitle}</span>
          </span>
          {email && <ChevronRight aria-hidden size={18} className="shrink-0 text-ink-tertiary" />}
        </button>
        {rows.dashboard && <SettingsRow icon={<LayoutDashboard />} label={t("mobile.settings.accountDashboard")} onClick={() => void accountDashboardUrl().then((url) => platform.openExternal(url))} />}
        {rows.signIn && <SettingsRow icon={<UserRound />} label={t("mobile.entry.signIn")} detail={t("mobile.settings.signInDetail")} onClick={() => { onClose(); window.dispatchEvent(new Event("dusk:sign-in")); }} />}
      </SettingsSection>

      <SettingsSection card title={t("mobile.settings.workspaces")} hint={error ? <span role="alert" className="text-danger">{t("mobile.settings.workspaceError")}</span> : t("mobile.settings.workspacesHint")}>
        {connections.map((connection) => (
          <WorkspaceRow key={connection.id} connection={connection} active={connection.id === activeId} confirming={unlinkId === connection.id} busy={busy} onSelect={() => { void changeWorkspace(connection.id); }} onConfirm={() => { setError(false); setUnlinkId(connection.id); }} onCancel={() => { setUnlinkId(null); setError(false); }} onUnlink={() => { void changeWorkspace(connection.id, true); }} />
        ))}
        <SettingsRow icon={<Plus />} label={t("mobile.settings.link")} onClick={() => { onClose(); window.dispatchEvent(new Event("dusk:link-another")); }} />
      </SettingsSection>

      <SettingsSection card>
        <SettingsRow icon={<Bell />} label={t("mobile.settings.notifications")} value={unread || undefined} onClick={() => push("notifications")} />
      </SettingsSection>

      <SettingsSection card title={t("mobile.settings.phone")}>
        <div role="group" aria-label={t("mobile.settings.appearance")} className="flex items-center gap-3 px-4 py-2">
          <Palette aria-hidden className="size-5 shrink-0 text-ink-secondary" />
          <div className="flex flex-1 rounded-full bg-ink/[0.06] p-1">
            {([{ choice: "system", label: t("mobile.settings.system") }, { choice: THEME_SKINS.light, label: t("mobile.settings.light") }, { choice: THEME_SKINS.dark, label: t("mobile.settings.dark") }] as const).map(({ choice, label }) => (
              <button key={choice} type="button" aria-pressed={skin === choice} onClick={() => { haptic("selection"); applySkinChoice(choice); }} className="mobile-press relative flex min-h-10 flex-1 items-center justify-center rounded-full px-2 text-[15px] font-semibold">
                {skin === choice && <motion.span aria-hidden layoutId={`${appearanceId}-selection`} className="absolute inset-0 rounded-full bg-app shadow-sm" transition={spring.settle} />}
                <span className={skin === choice ? "relative text-ink" : "relative text-ink-secondary"}>{label}</span>
              </button>
            ))}
          </div>
        </div>
        <SettingsSwitch icon={<Hand />} label={t("mobile.settings.haptics")} checked={hapticsEnabled} onChange={(enabled) => { setHapticsEnabled(enabled); haptic("selection"); }} />
        <SettingsRow icon={<Mic />} label={t("settings.voice.title")} onClick={() => push("voice")} />
        <SettingsRow icon={<Globe />} label={t("mobile.settings.language")} value={localeChoices.find((choice) => choice.code === language)?.label ?? t("mobile.settings.system")} onClick={() => push("language")} />
      </SettingsSection>

      <SettingsSection card title={t("mobile.settings.bots")}>
        <SettingsRow icon={<CalendarClock />} label={t("mobile.settings.routines")} onClick={() => push("routines")} />
        <SettingsRow icon={<Plug />} label={t("mobile.settings.connectors")} onClick={() => push("connectors")} />
        <SettingsRow icon={<KeyRound />} label={t("mobile.settings.vault")} onClick={() => push("vault")} />
      </SettingsSection>

      {consent && (
        <SettingsSection card title={t("mobile.settings.privacyTitle")}>
          <SettingsRow icon={<ShieldCheck />} label={t("mobile.settings.aiSharing")} value={t(consent.covered ? "mobile.settings.aiSharingOn" : "mobile.settings.aiSharingOff")} onClick={() => { onClose(); consent.open(); }} />
        </SettingsSection>
      )}

      <SettingsSection card title={t("mobile.settings.about")}>
        <SettingsRow icon={<LifeBuoy />} label={t("mobile.settings.help")} onClick={() => void platform.openExternal(LEGAL_LINKS.help)} />
        <SettingsRow icon={<Mail />} label={t("mobile.settings.contact")} onClick={() => void platform.openExternal(supportMail(t("mobile.settings.contactSubject")))} />
        <SettingsRow icon={<ShieldCheck />} label={t("mobile.settings.privacy")} onClick={() => void platform.openExternal(LEGAL_LINKS.privacy)} />
        <SettingsRow icon={<FileText />} label={t("mobile.settings.terms")} onClick={() => void platform.openExternal(LEGAL_LINKS.terms)} />
      </SettingsSection>
      <p className="mt-6 text-center text-[13px] text-ink-tertiary">{t("mobile.settings.version", { version: platform.appVersion })}</p>
      {rows.dashboard && !state.config?.cloudHome && <CloudCard onOpen={() => void accountDashboardUrl().then((url) => platform.openExternal(url))} />}
    </div>
  );
}

function LanguagePage() {
  const { state } = useStore();
  const language = effectiveLanguage(useLanguageChoice(), state.config?.language);
  return (
    <Sheet open onClose={() => {}} title={t("mobile.settings.language")}>
      <SettingsSection card>
        {[{ code: "", label: t("mobile.settings.system") }, ...localeChoices].map(({ code, label }) => (
          <button key={code} type="button" aria-pressed={language === code} onClick={() => { haptic("selection"); setLanguageChoice(code); }} className="mobile-row flex min-h-[52px] w-full items-center gap-3 px-4 py-2 text-left text-[16px] font-medium text-ink">
            <span className="min-w-0 flex-1">{label}</span>
            {language === code && <Check aria-hidden size={20} />}
          </button>
        ))}
      </SettingsSection>
    </Sheet>
  );
}

/** The signed-in account: who it is, signing out, and deleting it after one plain confirmation on the same page. */
function AccountPage({ onDone }: { onDone: () => void }) {
  const account = useMobileAccount();
  const email = account?.account?.email ?? "";
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [failed, setFailed] = useState(false);
  const deleteAccount = async () => {
    if (deleting || !account) return;
    setDeleting(true);
    setFailed(false);
    const deleted = await account.deleteAccount().catch(() => false);
    setDeleting(false);
    if (!deleted) { haptic("error"); setFailed(true); return; }
    haptic("success");
    onDone();
  };
  return (
    <Sheet open onClose={() => {}} title={t("mobile.settings.account")}>
      <SettingsSection card hint={email}>
        <SettingsRow icon={<LogOut />} label={t("accountGate.signOut")} chevron={false} onClick={() => { haptic("light"); void account?.signOut(); onDone(); }} />
      </SettingsSection>
      <SettingsSection card hint={confirming ? undefined : t("mobile.settings.deleteNow", { email })}>
        {!confirming
          ? <SettingsRow icon={<Trash2 />} label={t("mobile.settings.deleteAccount")} danger chevron={false} onClick={() => setConfirming(true)} />
          : (
            <div className="px-4 py-4" aria-busy={deleting}>
              <p className="text-[16px] font-semibold text-ink">{t("mobile.settings.deleteTitle")}</p>
              <p className="mt-1 text-[14px] leading-5 text-ink-secondary">{t("mobile.settings.deleteNow", { email })}</p>
              {failed && <p role="alert" className="mt-2 text-[14px] leading-5 text-danger">{t("mobile.settings.deleteFailed")}</p>}
              <div className="mt-4 flex gap-2">
                <button type="button" disabled={deleting} onClick={() => setConfirming(false)} className="mobile-press flex min-h-11 flex-1 items-center justify-center rounded-full bg-ink/[0.06] px-4 text-[15px] font-semibold text-ink">{t("mobile.settings.cancel")}</button>
                <button type="button" disabled={deleting} onClick={() => void deleteAccount()} className="mobile-press flex min-h-11 flex-1 items-center justify-center rounded-full bg-danger px-4 text-[15px] font-semibold text-[var(--color-danger-ink)] disabled:opacity-60">{deleting ? <WorkingDots /> : t("mobile.settings.deleteConfirm")}</button>
              </div>
            </div>
          )}
      </SettingsSection>
    </Sheet>
  );
}

function WorkspaceRow({ connection, active, confirming, busy, onSelect, onConfirm, onCancel, onUnlink }: {
  connection: MobileConnectionRecord;
  active: boolean;
  confirming: boolean;
  busy: boolean;
  onSelect: () => void;
  onConfirm: () => void;
  onCancel: () => void;
  onUnlink: () => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  useLongPress(ref, onConfirm, !confirming && !busy);
  if (confirming) return (
    <div className="px-4 py-2" aria-busy={busy}>
      <p className="text-[16px] font-semibold text-ink">{t("mobile.settings.unlinkQuestion", { name: connection.label })}</p>
      <div className="mt-1 flex gap-2">
        <button autoFocus type="button" disabled={busy} onClick={onCancel} className="mobile-press min-h-11 rounded-full bg-ink/[0.05] px-5 text-[14px] font-semibold text-ink disabled:opacity-40">{t("mobile.settings.cancel")}</button>
        <button type="button" disabled={busy} onClick={onUnlink} className="mobile-press min-h-11 rounded-full px-5 text-[14px] font-semibold text-danger disabled:opacity-40">{t("mobile.settings.unlink")}</button>
      </div>
    </div>
  );
  return (
    <div className="flex items-center pr-2">
      <button ref={ref} type="button" disabled={busy} aria-current={active ? "true" : undefined} onClick={active ? undefined : onSelect} className="mobile-row flex min-h-14 min-w-0 flex-1 items-center gap-3 rounded-2xl px-4 py-2.5 text-left text-ink disabled:opacity-40">
        <span className="min-w-0 flex-1 truncate text-[16px] font-semibold">{connection.label}</span>
        {active && <Check size={20} aria-label={t("mobile.settings.active")} />}
      </button>
      <button type="button" disabled={busy} aria-label={t("mobile.settings.workspaceActions", { name: connection.label })} onClick={onConfirm} className="mobile-press flex size-11 shrink-0 items-center justify-center rounded-full text-ink-secondary disabled:opacity-40"><MoreHorizontal aria-hidden size={20} /></button>
    </div>
  );
}
