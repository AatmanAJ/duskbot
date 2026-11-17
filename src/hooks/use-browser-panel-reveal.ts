import { useEffect, useRef } from "react";
import { writeComputerPanelView } from "@/lib/computer-panel-view";
import { useLocalBrowser } from "@/lib/local-browser";
import type { Action, Bot } from "@/state/store";

/** The bot's browser on this computer opening during a turn opens the panel's Computer tab on it, once per turn, so the
 * person sees the bot browse without looking for it. Only in the desktop app, which shows that browser. */
export function useBrowserPanelReveal({ bot, active, dispatch }: {
  bot: Pick<Bot, "id" | "threadId" | "busy" | "browser"> | undefined;
  active: boolean;
  dispatch: (action: Action) => void;
}) {
  const desktop = typeof window !== "undefined" && Boolean(window.duskDesktop) && window.duskDesktop?.remoteClient?.active !== true;
  const watching = Boolean(desktop && active && bot?.busy && bot.browser !== false);
  const { open, known } = useLocalBrowser(bot?.id ?? "", bot?.threadId, watching);
  // per turn: whether its browser was open when first seen, and whether this turn already opened the panel
  const turn = useRef<{ key: string; wasOpen: boolean; revealed: boolean } | null>(null);
  useEffect(() => {
    if (!watching || !bot) { turn.current = null; return; }
    if (!known) return;
    const key = `${bot.id}\n${bot.threadId ?? ""}`;
    if (turn.current?.key !== key) { turn.current = { key, wasOpen: open, revealed: false }; return; }
    if (!open) { turn.current.wasOpen = false; return; }
    if (turn.current.wasOpen || turn.current.revealed) return;
    turn.current.revealed = true;
    writeComputerPanelView(bot.id, "browser");
    dispatch({ type: "toggleComputer", open: true });
  }, [watching, known, open, bot?.id, bot?.threadId, dispatch]);
}
