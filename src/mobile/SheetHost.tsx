import { botAccentScope } from "@/lib/bot-accent";
import { Suspense, useEffect, useRef, type ReactNode } from "react";
import { useStore, type Action } from "@/state/store";
import { BotSettingsDialog, RoomPanel } from "@/components/lazy-screens";
import { t } from "@/lib/i18n";
import { ModelRowSlot } from "@/components/bot-panel/model-row-slot";
import { PhoneModelRow } from "./PhoneModelRow";
import { Sheet } from "./Sheet";
import type { MobileSheet, OpenSheet } from "./sheets";
import { SHEET_PAGES } from "./sheets/registry";
import "./sheets/sheets.css";

/** What opening a bot's sheet tells the store, dispatched with the open itself so the panel and the sheet arrive in one
 * render instead of a second one landing in the sheet's first frames. A room has no store panel: the store ignores it. */
export function panelOpenAction(sheet: MobileSheet): Action | null {
  if (sheet.kind === "computer") return { type: "toggleComputer", open: true, botId: sheet.botId };
  if (sheet.kind === "profile") return { type: "toggleSettings", open: true, botId: sheet.id };
  return null;
}

/** The bot's own panel (profile, conversations, library, routines, computer) in a full sheet. The store still thinks
 * of it as the side panel, so opening and closing keep `settingsOpen` in step both ways. */
function PanelSheet({ sheet, open, onClose }: { sheet: Extract<MobileSheet, { kind: "profile" | "computer" }>; open: boolean; onClose: () => void }) {
  const { state, dispatch } = useStore();
  const id = sheet.kind === "profile" ? sheet.id : sheet.botId;
  const bot = state.bots.find((b) => b.id === id);
  const group = bot ? undefined : state.groups.find((g) => g.id === id);
  const wasOpen = useRef(false);

  useEffect(() => {
    if (!bot) return;
    if (state.settingsOpen) wasOpen.current = true;
    else if (wasOpen.current && open) { wasOpen.current = false; onClose(); }
  }, [state.settingsOpen, bot, open, onClose]);
  useEffect(() => {
    if (open) return;
    // a sheet closed from the phone (a swipe, the scrim, Back) must not read as the panel closing itself next time it opens
    wasOpen.current = false;
    if (state.settingsOpen) dispatch({ type: "toggleSettings", open: false });
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Sheet open={open} onClose={onClose} full flush label={bot?.name ?? group?.name ?? t("mobile.sheet.profile")} bodyClassName="mobile-panel-sheet">
      <ModelRowSlot.Provider value={PhoneModelRow}>
        <Suspense fallback={null}>
          {bot ? <div {...botAccentScope(bot.color)} className="contents"><BotSettingsDialog key={`settings:${bot.id}`} bot={bot} /></div> : group ? <RoomPanel key={`room:${group.id}`} group={group} initialTab={sheet.kind === "computer" ? "computer" : "details"} /> : null}
        </Suspense>
      </ModelRowSlot.Provider>
    </Sheet>
  );
}

export function SheetHost({ sheet, open, onClose, onOpenSheet, onOpenChat }: {
  sheet: MobileSheet | null;
  open: boolean;
  onClose: () => void;
  onOpenSheet: OpenSheet;
  onOpenChat: (id: string) => void;
}) {
  if (!sheet) return null;
  if (sheet.kind === "profile" || sheet.kind === "computer") return <PanelSheet sheet={sheet} open={open} onClose={onClose} />;
  const Page = SHEET_PAGES[sheet.kind];
  const content: ReactNode = Page ? <Page sheet={sheet as never} onClose={onClose} onOpenSheet={onOpenSheet} onOpenChat={onOpenChat} open={open} /> : null;
  return <>{content}</>;
}
