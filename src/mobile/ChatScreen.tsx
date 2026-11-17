import { useSyncExternalStore } from "react";
import { ChevronLeft, Monitor } from "../icons";
import { useStoreSelector, type Bot, type Group } from "@/state/store";
import { ChatView } from "@/components/ChatView";
import { GroupView } from "@/components/GroupView";
import { BotAvatar } from "@/components/Avatar";
import { GroupAvatar } from "@/components/GroupAvatar";
import { t } from "@/lib/i18n";
import { cloudWaking, onCloudWaking } from "@/lib/cloud-power";
import { WorkingDots } from "@/components/WorkingIndicator";
import { RoundButton } from "./RoundButton";

/** The shared chat, with Grok's floating nav in place of its header row: back, the bot's pill (its profile), and the
 * computer. The shared header keeps its height under the nav, so the transcript starts where it always does. */
export function ChatScreen({ bot, group, members, onBack, onProfile, onComputer }: {
  bot?: Bot;
  group?: Group;
  members: Bot[];
  onBack: () => void;
  onProfile: () => void;
  onComputer?: () => void;
}) {
  const held = useStoreSelector((s) => bot ? s.computerControl[bot.id]?.held : undefined);
  const name = group?.name ?? bot?.name ?? "";
  const live = Boolean(bot && (bot.busy || held));
  const waking = useSyncExternalStore(onCloudWaking, cloudWaking, () => false);
  return (
    <div data-mobile-chat className="relative flex h-full flex-col">
      {group ? <GroupView key={group.id} group={group} /> : bot ? <ChatView bot={bot} /> : null}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 z-[29] h-[calc(var(--m-safe-top)+78px)]" style={{ background: "linear-gradient(to bottom, var(--color-app) calc(100% - 24px), transparent)" }} />
      <nav
        aria-label={t("mobile.chat.nav", { name })}
        className="pointer-events-none absolute inset-x-0 top-0 z-30 flex items-center gap-2 px-3 pt-[calc(var(--m-safe-top)+6px)]"
      >
        <RoundButton floating label={t("mobile.chat.back")} onClick={onBack} className="pointer-events-auto">
          <ChevronLeft size={22} strokeWidth={2} />
        </RoundButton>
        <button
          type="button"
          onClick={onProfile}
          aria-label={t("mobile.chat.openProfile", { name })}
          className="mobile-press mobile-float pointer-events-auto flex h-11 min-w-0 max-w-[60%] items-center gap-2 rounded-full bg-composer pl-1.5 pr-4 text-ink"
        >
          {group
            ? <GroupAvatar members={members} size={30} />
            : bot && <BotAvatar bot={bot} size={30} state="idle" animated={false} />}
          <span className="min-w-0 truncate text-[15px] font-semibold">{name}</span>
        </button>
        <div className="flex min-w-0 flex-1 justify-center">
          {waking && (
            <span role="status" data-testid="mobile-chat-cloud-status" className="flex h-11 items-center gap-1.5 whitespace-nowrap rounded-full bg-composer px-4 text-[13px] font-medium text-ink-secondary mobile-float">
              <WorkingDots size={3} />{t("cloudAsleep.waking")}
            </span>
          )}
        </div>
        {onComputer && (
          <RoundButton floating label={live ? `${t("mobile.chat.computer")}, ${t("place.live")}` : t("mobile.chat.computer")} onClick={onComputer} className="pointer-events-auto">
            <Monitor size={19} strokeWidth={1.8} />
            {live && <span aria-hidden className="absolute right-2.5 top-2.5 size-2 rounded-full bg-success ring-2 ring-composer" />}
          </RoundButton>
        )}
      </nav>
    </div>
  );
}
