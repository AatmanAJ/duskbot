import { useProductScreen } from "@/lib/product-analytics-app";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { MotionConfig } from "motion/react";
import { openBot, openBotThread, openRoomThread, StoreProvider, useDispatch, useStoreSelector } from "@/state/store";
import { useStoreRef } from "@/state/store-ref";
import { useTeamChats } from "@/state/team-chats";
import { useWarmChatImages } from "@/components/use-warm-chat-images";
import { ThreadRefsProvider } from "@/components/ThreadRefs";
import { DesktopCapabilitiesProvider } from "@/components/DesktopCapabilities";
import { LiveCallHost } from "@/components/LiveCallHost";
import { liveCallEnabled } from "@/lib/feature-flags";
import { ConnectAppsHost } from "@/components/connect-apps";
import { openChatLink } from "@/components/ThreadRefs";
import { parseBotRefUrl, parseThreadRefUrl } from "@/lib/thread-refs"; import { completeSlackOAuth } from "@/lib/slack-oauth-link"; import { parseSlackOAuthLink } from "../../shared/slack";
import { effectiveLanguage, useLanguageChoice, usePageLanguage } from "@/lib/language-preference";
import { parseMobileOpenLink, type MobileOpenTarget } from "../../shared/mobile-link";
import { setChatCovered } from "@/lib/chat-in-front";
import { readSkinChoice, subscribeSkin, THEME_SKINS } from "@/lib/skins";
import { screenViewAllowed } from "@/lib/store-app";
import { AiConsentProvider } from "./consent/AiConsent";
import { installAiReport } from "@/lib/ai-report";
import { registerPushForConnection } from "./connection/push";
import { supportMail } from "./legal";
import { NavStack } from "./NavStack";
import { ChatScreen } from "./ChatScreen";
import { HomeScreen, releasePressed } from "./HomeScreen";
import { SheetHost } from "./SheetHost";
import { closeTopSheet, Sheet } from "./Sheet";
import { t } from "@/lib/i18n";
import { useKeyboardSync } from "./keyboard";
import { useChatHaptics } from "./use-chat-haptics";
import { useOutbox } from "./outbox";
import { usePlatform } from "./platform";
import type { MobileSheet } from "./sheets";

function ChatHaptics({ chatId }: { chatId: string | null }) {
  const platform = usePlatform();
  // notifications are asked for when they mean something: once a message is on its way and its reply will follow
  useChatHaptics(chatId, useCallback(() => { if (platform.native) void registerPushForConnection(platform, { prompt: true }); }, [platform]));
  return null;
}

function Shell() {
  const platform = usePlatform();
  const dispatch = useDispatch();
  const store = useStoreRef();
  const config = useStoreSelector((s) => s.config);
  const bots = useStoreSelector((s) => s.bots);
  const groups = useStoreSelector((s) => s.groups);
  const hydrated = useStoreSelector((s) => s.hydrated);
  const appSettingsOpen = useStoreSelector((s) => s.appSettingsOpen);
  const appSettingsSection = useStoreSelector((s) => s.appSettingsSection);
  const rootRef = useRef<HTMLDivElement>(null);
  const [chatId, setChatId] = useState<string | null>(null);
  const [sheet, setSheet] = useState<MobileSheet | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  useProductScreen(sheetOpen && sheet ? `/${sheet.kind}` : chatId ? "/chats/:id" : "/", chatId);
  useTeamChats(config);
  useWarmChatImages(bots);
  usePageLanguage(effectiveLanguage(useLanguageChoice(), config?.language));
  useKeyboardSync(platform, rootRef);
  useOutbox();
  // a bot's reply someone finds harmful or wrong goes to a person at dusk bot, with the reply in the mail they send
  useEffect(() => installAiReport(({ text, messageId }) => {
    void platform.openExternal(supportMail(t("mobile.report.subject"), t("mobile.report.body", { text: text.slice(0, 1500), id: messageId })));
  }), [platform]);

  // the status bar's clock and battery follow the look, when it is changed in Settings and when the system's changes
  const skin = useSyncExternalStore(subscribeSkin, readSkinChoice, () => "system");
  useEffect(() => {
    // an open sheet steps the page back onto a dark ground, so the clock turns light over it
    const apply = () => platform.setStatusBar?.(sheetOpen || document.documentElement.dataset.skin === THEME_SKINS.dark ? "light" : "dark");
    apply();
    const system = window.matchMedia?.("(prefers-color-scheme: dark)");
    const later = () => setTimeout(apply, 0);
    system?.addEventListener("change", later);
    return () => system?.removeEventListener("change", later);
  }, [platform, skin, sheetOpen]);

  // with the list in front, the chat last opened is not being read: its replies stay unread and still notify
  useEffect(() => { setChatCovered(chatId === null); return () => setChatCovered(false); }, [chatId]);

  const openChat = useCallback((id: string) => {
    const current = store.state();
    const bot = current.bots.find((b) => b.id === id);
    if (bot) openBot(dispatch, bot);
    else dispatch({ type: "select", id });
    setChatId(id);
  }, [dispatch, store]);

  const openSheet = useCallback((next: MobileSheet) => {
    setSheet(next);
    setSheetOpen(true);
  }, []);
  const closeSheet = useCallback(() => setSheetOpen(false), []);

  // a shared card that opens the computer app's settings (connect an AI, add a key) has nothing to open on a phone: it
  // says where that lives instead of doing nothing
  const [desktopOnly, setDesktopOnly] = useState(false);
  useEffect(() => {
    if (!appSettingsOpen) return;
    dispatch({ type: "toggleAppSettings", open: false });
    // voice input is set up on the phone itself: its own settings sheet has the page
    if (appSettingsSection === "voice") openSheet({ kind: "settings", page: "voice" });
    else setDesktopOnly(true);
  }, [appSettingsOpen, appSettingsSection, dispatch, openSheet]);

  const openTarget = useCallback((target: MobileOpenTarget) => {
    const id = target.botId ?? target.groupId;
    if (id) {
      const latest = store.state();
      const bot = latest.bots.find((b) => b.id === id);
      if (bot && target.threadId) { openBotThread(dispatch, bot, target.threadId, true); setChatId(bot.id); }
      else if (target.groupId && target.threadId) { openRoomThread(dispatch, { groupId: target.groupId, threadId: target.threadId }, latest.groups); setChatId(target.groupId); }
      else openChat(id);
      if (target.messageId && target.threadId) dispatch({ type: "focusMessage", threadId: target.threadId, messageId: target.messageId });
    }
    if (target.view === "computer" && target.botId && screenViewAllowed()) openSheet({ kind: "computer", botId: target.botId });
    else if (target.view === "profile" && id) openSheet({ kind: "profile", id });
    else if (target.view === "settings") openSheet({ kind: "settings" });
    else if (target.view === "notifications") openSheet({ kind: "notifications" });
    else if (target.view === "routines") openSheet({ kind: "routines", botId: target.botId });
  }, [dispatch, store, openChat, openSheet]);

  useEffect(() => platform.onAppUrl?.((url) => {
    if (parseSlackOAuthLink(url)) { void completeSlackOAuth(url); return true; }
    const target = parseMobileOpenLink(url);
    if (target) { openTarget(target); return true; }
    // the desktop's own chat links open the same chat here
    const bot = parseBotRefUrl(url);
    const thread = parseThreadRefUrl(url);
    if (!bot && !thread) return false;
    const latest = store.state();
    if (openChatLink(dispatch, url, latest, true)) {
      const owner = bot?.botId ?? thread?.botId ?? latest.groups.find((g) => g.threadId === thread?.threadId || g.tasks?.some((task) => task.threadId === thread?.threadId))?.id
        ?? latest.bots.find((b) => b.threadId === thread?.threadId || b.tasks?.some((task) => task.threadId === thread?.threadId))?.id;
      if (owner) setChatId(owner);
    }
    return true;
  }), [platform, openTarget, dispatch, store]);
  useEffect(() => platform.onNotificationOpen?.(openTarget), [platform, openTarget]);

  useEffect(() => platform.onBack?.(() => {
    if (closeTopSheet()) return true;
    if (chatId) { setChatId(null); return true; }
    return false;
  }), [platform, chatId]);

  // a resumed app reads the chat on screen, as a refocused desktop window does
  useEffect(() => platform.onResume?.(() => { if (chatId) dispatch({ type: "select", id: chatId }); }), [platform, chatId, dispatch]);

  const group = chatId ? groups.find((g) => g.id === chatId) : undefined;
  const bot = chatId && !group ? bots.find((b) => b.id === chatId) : undefined;
  const members = useMemo(() => group ? bots.filter((b) => group.memberIds.includes(b.id)) : [], [group, bots]);
  useEffect(() => { if (chatId && hydrated && !group && !bot) setChatId(null); }, [chatId, hydrated, group, bot]);

  const page = bot || group ? (
    <ChatScreen
      bot={bot}
      group={group}
      members={members}
      onBack={() => setChatId(null)}
      onProfile={() => openSheet({ kind: "profile", id: chatId! })}
      onComputer={bot && screenViewAllowed() ? () => openSheet({ kind: "computer", botId: bot.id }) : undefined}
    />
  ) : null;

  return (
    <div ref={rootRef} className="dusk-mobile relative">
      <ChatHaptics chatId={chatId} />
      <NavStack
        base={<HomeScreen onOpenChat={openChat} onOpenSheet={openSheet} />}
        page={page}
        pageKey={page ? chatId : null}
        onBack={() => setChatId(null)}
        onSettled={releasePressed}
      />
      <SheetHost sheet={sheet} open={sheetOpen} onClose={closeSheet} onOpenSheet={openSheet} onOpenChat={(id) => { closeSheet(); openChat(id); }} />
      <ConnectAppsHost />
      <Sheet open={desktopOnly} onClose={() => setDesktopOnly(false)} title={t("mobile.desktopOnly.title")}>
        <div className="px-5 pb-[calc(var(--m-safe-bottom)+16px)]">
          <p className="text-[15px] leading-6 text-ink-secondary">{t("mobile.desktopOnly.body")}</p>
          <button type="button" onClick={() => setDesktopOnly(false)} className="mobile-press mt-5 flex min-h-12 w-full items-center justify-center rounded-full bg-ink text-[16px] font-semibold text-app">{t("mobile.desktopOnly.done")}</button>
        </div>
      </Sheet>
    </div>
  );
}

export function MobileApp() {
  return (
    <MotionConfig reducedMotion="user">
      <DesktopCapabilitiesProvider>
        <StoreProvider>
          <ThreadRefsProvider>
            <AiConsentProvider><Shell /></AiConsentProvider>
          </ThreadRefsProvider>
          {liveCallEnabled() && <LiveCallHost />}
        </StoreProvider>
      </DesktopCapabilitiesProvider>
    </MotionConfig>
  );
}
