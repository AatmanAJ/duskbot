import { LayoutGrid, MessageSquareText, Puzzle, Search, X } from "../icons";

import { openFeedback } from "@/lib/feedback-sheet";

import { t } from "@/lib/i18n";
import { useDispatch, useStoreSelector } from "@/state/store";

import { CloudRoomCard } from "./CloudRoomCard";
import { CloudUsageCard } from "./CloudUsageMeter";
import { SidebarPopoverMenu, type SidebarMenuItem } from "./SidebarPopoverMenu";

/** The phone's bottom bar: a round button for the tools that are rows in the desktop sidebar, and a search pill. */
export function SidebarPhoneBar({ query, onQuery }: { query: string; onQuery: (query: string) => void }) {
  const dispatch = useDispatch();
  const pluginsOpen = useStoreSelector((s) => s.pluginsOpen);
  const items: SidebarMenuItem[] = [
    {
      key: "apps",
      label: t("sidebar.nav.apps"),
      icon: <Puzzle size={18} />,
      active: pluginsOpen,
      onSelect: () => dispatch({ type: "togglePlugins", open: true }),
    },
    { key: "feedback", label: t("giveFeedback.card"), icon: <MessageSquareText size={18} />, onSelect: openFeedback },
  ];
  return (
    <div data-sidebar-phone-bar className="px-3 pb-3 pt-1">
      <CloudRoomCard />
      <CloudUsageCard />
      <div className="flex items-center gap-2 not-first:mt-2">
        <SidebarPopoverMenu
          items={items}
          ariaLabel={t("sidebar.tools")}
          triggerClassName="shrink-0 rounded-full"
          triggerTitle={t("sidebar.tools")}
          renderTrigger={({ open }) => (
            <span className={`relative flex size-11 items-center justify-center rounded-full border border-transparent text-ink ${open ? "bg-raised" : "bg-card"}`}>
              <LayoutGrid size={19} aria-hidden="true" />
            </span>
          )}
        />
        <div className="flex h-11 min-w-0 flex-1 items-center gap-2 rounded-full border border-transparent bg-card pl-3.5 pr-0.5 text-ink-secondary">
          <Search size={17} aria-hidden="true" className="shrink-0" />
          <input
            value={query}
            onChange={(event) => onQuery(event.target.value)}
            onKeyDown={(event) => event.key === "Escape" && onQuery("")}
            placeholder={t("sidebar.search")}
            aria-label={t("sidebar.searchAria")}
            enterKeyHint="search"
            className="min-w-0 flex-1 bg-transparent text-[16px] text-ink placeholder:text-ink-secondary focus:outline-none"
          />
          {query !== "" && (
            <button
              type="button"
              onClick={() => onQuery("")}
              aria-label={t("sidebar.searchClose")}
              className="flex size-10 shrink-0 items-center justify-center rounded-full text-ink-secondary hover:bg-raised hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus"
            >
              <X size={15} aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
