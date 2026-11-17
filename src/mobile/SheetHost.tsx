import { Suspense, useEffect, useRef, type ReactNode } from "react";
import { useDispatch, useStoreSelector } from "@/state/store";
import { botById, groupById } from "@/state/store-index";
import { BotSettingsDialog, RoomPanel } from "@/components/lazy-screens";
import { t } from "@/lib/i18n";
import { Sheet } from "./Sheet";
import type { MobileSheet, OpenSheet } from "./sheets";
import { SHEET_PAGES } from "./sheets/registry";
import "./sheets/sheets.css";

/** The bot's own panel (profile, conversations, library, routines, computer) in a full sheet. The store still thinks
 * of it as the side panel, so opening and closing keep `settingsOpen` in step both ways. */
function PanelSheet({ sheet, open, onClose }: { sheet: Extract<MobileSheet, { kind: "profile" | "computer" }>; open: boolean; onClose: () => void }) {
  const dispatch = useDispatch();
  const id = sheet.kind === "profile" ? sheet.id : sheet.botId;
  const bot = useStoreSelector((s) => botById(s, id));
  const group = useStoreSelector((s) => botById(s, id) ? undefined : groupById(s, id));
  const settingsOpen = useStoreSelector((s) => s.settingsOpen);
  const wasOpen = useRef(false);

  useEffect(() => {
    if (!open || !bot) return;
    dispatch(sheet.kind === "computer" ? { type: "toggleComputer", open: true, botId: bot.id } : { type: "toggleSettings", open: true, botId: bot.id });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, sheet.kind, id]);
  useEffect(() => {
    if (!bot) return;
    if (settingsOpen) wasOpen.current = true;
    else if (wasOpen.current && open) { wasOpen.current = false; onClose(); }
  }, [settingsOpen, bot, open, onClose]);
  useEffect(() => { if (!open && settingsOpen) dispatch({ type: "toggleSettings", open: false }); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Sheet open={open} onClose={onClose} full flush label={bot?.name ?? group?.name ?? t("mobile.sheet.profile")} bodyClassName="mobile-panel-sheet">
      <Suspense fallback={null}>
        {bot ? <BotSettingsDialog key={`settings:${bot.id}`} bot={bot} /> : group ? <RoomPanel key={`room:${group.id}`} group={group} /> : null}
      </Suspense>
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
