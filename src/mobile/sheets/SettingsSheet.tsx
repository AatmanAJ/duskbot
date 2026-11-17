import { useEffect, useId, useRef, useState, useSyncExternalStore, type ComponentType } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Bell, CalendarClock, Check, FileText, Globe, KeyRound, LayoutDashboard, LifeBuoy, LogOut, Mail, Mic, MoreHorizontal, Palette, Plug, Plus, ShieldCheck, Trash2, UserRound } from "../../icons";
import { accountDashboardUrl } from "@/lib/account-dashboard";
import { useGroupYou } from "@/components/GroupAvatar";
import { UserFace } from "@/components/UserAvatar";
import { trackUpsell, watchUpsell } from "@/lib/cloud-upsell";
import { t } from "@/lib/i18n";
import { effectiveLanguage, setLanguageChoice, useLanguageChoice, usePageLanguage } from "@/lib/language-preference";
import { applySkinChoice, readSkinChoice, subscribeSkin, THEME_SKINS } from "@/lib/skins";
import { localeChoices } from "@/locales";
import { useStoreSelector } from "@/state/store";
import type { MobileConnectionRecord } from "../../../shared/mobile-link";
import { useLongPress } from "../ContextMenu";
import { useConnections } from "../connection/connections";
import { haptic, setHapticsEnabled, useHapticsEnabled } from "../haptics";
import { dur, ease, spring } from "../motion";
import { useMobileAccount } from "../account/AccountGate";
import { LEGAL_LINKS, SUPPORT_EMAIL, supportMail } from "../legal";
import { useAiConsent } from "../consent/AiConsent";
import { WorkingDots } from "@/components/WorkingIndicator";
import { SIMPLE_BUTTONS } from "@/components/SettingsPrimitives";
import { VoiceInputSettings } from "@/components/VoiceInputSettings";
import { usePlatform } from "../platform";
import { Sheet } from "../Sheet";
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

export const SettingsSheet: ComponentType<SheetPageProps<"settings">> = ({ sheet, open, onClose, onOpenSheet }) => {
  const configLanguage = useStoreSelector((s) => s.config?.language);
  const profileName = useStoreSelector((s) => s.config?.profile?.name);
  const cloudHome = useStoreSelector((s) => s.config?.cloudHome);
  const unreadNotes = useStoreSelector((s) => s.notifications.filter((entry) => !entry.read).length);
  const { connections, activeId, switchTo, remove } = useConnections();
  const you = useGroupYou();
  const face = useMobileAccount()?.account ?? you?.face ?? null;
  const platform = usePlatform();
  const account = useMobileAccount();
  const hapticsEnabled = useHapticsEnabled();
  const skin = useSyncExternalStore(subscribeSkin, readSkinChoice, () => "system");
  const language = effectiveLanguage(useLanguageChoice(), configLanguage);
  usePageLanguage(language);
  const [page, setPage] = useState<"main" | "language" | "voice" | "delete">(sheet.page === "language" || sheet.page === "voice" ? sheet.page : "main");
  const [unlinkId, setUnlinkId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const appearanceId = useId();
  const active = connections.find((connection) => connection.id === activeId);
  const email = account?.account?.email;
  const identity = settingsIdentity({ name: profileName, email, workspace: active?.label });
  const pageRef = useRef<HTMLDivElement>(null);
  // each page inside the sheet opens at its top, not where the last one was scrolled to
  useEffect(() => { const body = pageRef.current?.closest(".mobile-sheet-body"); if (body) body.scrollTop = 0; }, [page]);
  const rows = accountRows({ native: platform.native, signedIn: Boolean(email), offered: account?.offered });
  const consent = useAiConsent();
  const [deleting, setDeleting] = useState(false);
  const [deleteFailed, setDeleteFailed] = useState(false);
  const deleteAccount = async () => {
    if (deleting || !account) return;
    setDeleting(true);
    setDeleteFailed(false);
    const deleted = await account.deleteAccount().catch(() => false);
    setDeleting(false);
    if (!deleted) { haptic("error"); setDeleteFailed(true); return; }
    haptic("success");
    onClose();
  };

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
    <Sheet open={open} onClose={onClose} title={t(page === "language" ? "mobile.settings.language" : page === "voice" ? "settings.voice.title" : page === "delete" ? "mobile.settings.deleteAccount" : "mobile.settings.title")} full back={page !== "main" ? () => setPage("main") : undefined}>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div ref={pageRef} key={page} initial={{ y: 6, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -4, opacity: 0 }} transition={{ duration: dur.base, ease: ease.out }} className="px-2 pb-6">
          {page === "language" ? (
            <SettingsSection>
              {[{ code: "", label: t("mobile.settings.system") }, ...localeChoices].map(({ code, label }) => (
                <button key={code} type="button" aria-pressed={language === code} onClick={() => { haptic("selection"); setLanguageChoice(code); }} className="mobile-row flex min-h-12 w-full items-center gap-3 rounded-2xl px-4 py-3 text-left text-[16px] font-semibold text-ink">
                  <span className="min-w-0 flex-1">{label}</span>
                  {language === code && <Check aria-hidden size={20} />}
                </button>
              ))}
            </SettingsSection>
          ) : page === "voice" ? (
            // the same Settings > Voice the computer app shows, in Settings' own look
            <div data-settings-look="simple" className={`flex flex-col gap-6 px-2 pt-2 ${SIMPLE_BUTTONS}`}>
              <VoiceInputSettings />
            </div>
          ) : page === "delete" ? (
            <div className="px-4 pt-2" aria-busy={deleting}>
              <h2 className="text-[20px] font-semibold text-ink">{t("mobile.settings.deleteTitle")}</h2>
              <p className="mt-2 text-[15px] leading-6 text-ink-secondary">{t("mobile.settings.deleteNow", { email: email ?? "" })}</p>
              {deleteFailed && <p role="alert" className="mt-3 text-[15px] leading-6 text-danger">{t("mobile.settings.deleteFailed")}</p>}
              <div className="mt-6 flex flex-col gap-2">
                <button type="button" disabled={deleting} onClick={() => void deleteAccount()} className="mobile-press flex min-h-12 items-center justify-center rounded-full bg-danger px-5 text-[16px] font-semibold text-[var(--color-danger-ink)] disabled:opacity-60">{deleting ? <WorkingDots /> : t("mobile.settings.deleteConfirm")}</button>
                <button type="button" disabled={deleting} onClick={() => setPage("main")} className="mobile-press flex min-h-12 items-center justify-center rounded-full bg-ink/[0.05] px-5 text-[16px] font-semibold text-ink">{t("mobile.settings.cancel")}</button>
              </div>
            </div>
          ) : <>
            <div className="flex items-center gap-4 px-4 pb-6 pt-3">
              <span className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-full bg-ink/[0.06] text-[22px] font-semibold text-ink">
                {face ? <UserFace account={face} size={64} className="size-full" /> : you?.initials ?? <UserRound aria-hidden size={26} />}
              </span>
              <div className="min-w-0"><p className="truncate text-[22px] font-semibold leading-7 tracking-[-0.01em] text-ink">{identity.title}</p><p data-settings-identity className="truncate text-[15px] font-medium text-ink-secondary">{identity.subtitle}</p></div>
            </div>
            <SettingsSection>
              <SettingsRow icon={<Bell />} label={t("mobile.settings.notifications")} value={unreadNotes || undefined} onClick={() => onOpenSheet({ kind: "notifications" })} />
            </SettingsSection>
            <SettingsSection title={t("mobile.settings.bots")} art="books" hint={t("mobile.settings.botsHint")}>
              <SettingsRow icon={<CalendarClock />} label={t("mobile.settings.routines")} detail={t("mobile.settings.routinesDetail")} onClick={() => onOpenSheet({ kind: "routines" })} />
              <SettingsRow icon={<Plug />} label={t("mobile.settings.connectors")} detail={t("mobile.settings.connectorsDetail")} onClick={() => onOpenSheet({ kind: "connectors" })} />
              <SettingsRow icon={<KeyRound />} label={t("mobile.settings.vault")} detail={t("mobile.settings.vaultDetail")} onClick={() => onOpenSheet({ kind: "vault" })} />
            </SettingsSection>
            <SettingsSection title={t("mobile.settings.workspaces")} art="computer" hint={t("mobile.settings.workspacesHint")}>
              {connections.map((connection) => (
                <WorkspaceRow key={connection.id} connection={connection} active={connection.id === activeId} confirming={unlinkId === connection.id} busy={busy} onSelect={() => { void changeWorkspace(connection.id); }} onConfirm={() => { setError(false); setUnlinkId(connection.id); }} onCancel={() => { setUnlinkId(null); setError(false); }} onUnlink={() => { void changeWorkspace(connection.id, true); }} />
              ))}
              {error && <p role="alert" className="px-4 py-2 text-[14px] text-danger">{t("mobile.settings.workspaceError")}</p>}
              <SettingsRow icon={<Plus />} label={t("mobile.settings.link")} onClick={() => { onClose(); window.dispatchEvent(new Event("dusk:link-another")); }} />
            </SettingsSection>
            <SettingsSection title={t("mobile.settings.phone")} art="phone" hint={t("mobile.settings.phoneHint")}>
              <SettingsRow icon={<Palette />} label={t("mobile.settings.appearance")} />
              <div role="group" aria-label={t("mobile.settings.appearance")} className="mx-4 mb-2 flex rounded-full bg-ink/[0.06] p-1">
                {([{ choice: "system", label: t("mobile.settings.system") }, { choice: THEME_SKINS.light, label: t("mobile.settings.light") }, { choice: THEME_SKINS.dark, label: t("mobile.settings.dark") }] as const).map(({ choice, label }) => (
                  <button key={choice} type="button" aria-pressed={skin === choice} onClick={() => { haptic("selection"); applySkinChoice(choice); }} className="mobile-press relative flex min-h-11 flex-1 items-center justify-center rounded-full px-2 text-[15px] font-semibold">
                    {skin === choice && <motion.span aria-hidden layoutId={`${appearanceId}-selection`} className="absolute inset-0 rounded-full bg-ink" transition={spring.settle} />}
                    <span className={skin === choice ? "relative text-app" : "relative text-ink-secondary"}>{label}</span>
                  </button>
                ))}
              </div>
              <SettingsSwitch label={t("mobile.settings.haptics")} checked={hapticsEnabled} onChange={(enabled) => { if (!enabled) haptic("selection"); setHapticsEnabled(enabled); if (enabled) haptic("selection"); }} />
              <SettingsRow icon={<Mic />} label={t("settings.voice.title")} detail={t("settings.voice.rowHint")} onClick={() => setPage("voice")} />
              <SettingsRow icon={<Globe />} label={t("mobile.settings.language")} value={localeChoices.find((choice) => choice.code === language)?.label ?? t("mobile.settings.system")} onClick={() => setPage("language")} />
            </SettingsSection>
            {rows.dashboard && !cloudHome && <CloudCard onOpen={() => void accountDashboardUrl().then((url) => platform.openExternal(url))} />}
            {(rows.dashboard || rows.signOut || rows.signIn) && (
              <SettingsSection title={t("mobile.settings.account")} art="key" hint={email}>
                {rows.dashboard && <SettingsRow icon={<LayoutDashboard />} label={t("mobile.settings.accountDashboard")} onClick={() => void accountDashboardUrl().then((url) => platform.openExternal(url))} />}
                {rows.signIn && <SettingsRow icon={<UserRound />} label={t("mobile.entry.signIn")} detail={t("mobile.settings.signInDetail")} onClick={() => { onClose(); window.dispatchEvent(new Event("dusk:sign-in")); }} />}
                {rows.signOut && <SettingsRow icon={<LogOut />} label={t("accountGate.signOut")} onClick={() => void account?.signOut()} />}
                {rows.deleteAccount && <SettingsRow icon={<Trash2 />} label={t("mobile.settings.deleteAccount")} danger onClick={() => setPage("delete")} />}
              </SettingsSection>
            )}
            {consent && (
              <SettingsSection title={t("mobile.settings.privacyTitle")} art="key" hint={t("mobile.settings.privacyHint")}>
                <SettingsRow icon={<ShieldCheck />} label={t("mobile.settings.aiSharing")} value={t(consent.covered ? "mobile.settings.aiSharingOn" : "mobile.settings.aiSharingOff")} onClick={() => { onClose(); consent.open(); }} />
              </SettingsSection>
            )}
            <SettingsSection title={t("mobile.settings.about")} art="signpost">
              <SettingsRow icon={<ShieldCheck />} label={t("mobile.settings.privacy")} onClick={() => void platform.openExternal(LEGAL_LINKS.privacy)} />
              <SettingsRow icon={<FileText />} label={t("mobile.settings.terms")} onClick={() => void platform.openExternal(LEGAL_LINKS.terms)} />
              <SettingsRow icon={<LifeBuoy />} label={t("mobile.settings.help")} onClick={() => void platform.openExternal(LEGAL_LINKS.help)} />
              <SettingsRow icon={<Mail />} label={t("mobile.settings.contact")} detail={SUPPORT_EMAIL} onClick={() => void platform.openExternal(supportMail(t("mobile.settings.contactSubject")))} />
            </SettingsSection>
            <p className="mt-8 text-center text-[13px] font-medium text-ink-secondary">{t("mobile.settings.version", { version: platform.appVersion })}</p>
          </>}
        </motion.div>
      </AnimatePresence>
    </Sheet>
  );
};

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
