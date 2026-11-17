import { AnimatePresence, motion, useReducedMotion } from "motion/react";

import { t } from "@/lib/i18n";
import { useLocalBrowser } from "@/lib/local-browser";
import { DURATION, EASE, REDUCED } from "@/lib/motion-presets";
import { storeApp } from "@/lib/store-app";
import { useStore, type Bot } from "@/state/store";

import { SPOT_CARD } from "./SidebarSpot";
import { Art } from "./ui/Art";

/** The open bot's browser, while it is open: the server closes one that sat unused (browserIdleMs, 40 minutes on this
 * computer), and the card folds away with it; the next time the bot browses it folds back in. */
export function SidebarBrowserCard({ className }: { className?: string }) {
  const { state, dispatch } = useStore();
  const bot = state.activeView === "chat" ? state.bots.find((one) => one.id === state.selectedId) : undefined;
  const enabled = Boolean(bot) && bot!.browser !== false && !storeApp();
  const { open } = useLocalBrowser(bot?.id ?? "", bot?.threadId, enabled);
  return <SidebarBrowserCardView bot={enabled && open ? bot! : null} className={className}
    onOpen={(id) => dispatch({ type: "toggleComputer", open: true, botId: id })} />;
}

/** the card as it folds in and out under the sidebar's own section motion (SidebarSectionRows) */
export function SidebarBrowserCardView({ bot, className, onOpen }: { bot: Pick<Bot, "id" | "name"> | null; className?: string; onOpen: (botId: string) => void }) {
  const reduce = useReducedMotion();
  const tween = { duration: DURATION.base, ease: EASE.sharp };
  return (
    <AnimatePresence initial={false}>
      {bot && (
        <motion.div
          key="browser"
          data-sidebar-browser-card={bot.id}
          initial={{ height: 0, opacity: 0, overflow: "hidden" }}
          animate={{ height: "auto", opacity: 1, transitionEnd: { overflow: "visible" } }}
          exit={{ height: 0, opacity: 0, overflow: "hidden" }}
          transition={{ height: reduce ? { duration: 0 } : tween, opacity: reduce ? REDUCED : tween }}
        >
          <div className={className}>
            <button type="button" data-art-hover="" title={t("sidebar.browser.hint")} onClick={() => onOpen(bot.id)}
              className={SPOT_CARD}>
              <Art name="binoculars" className="h-5 w-5 shrink-0 object-contain" />
              <span className="min-w-0 flex-1 truncate text-[14px] font-medium leading-5 text-ink">{t("sidebar.browser.card", { name: bot.name })}</span>
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
