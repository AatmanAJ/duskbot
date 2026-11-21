import { localizedTaskTitle } from "@/lib/task-title";
import { Lock, UserRound, Users } from "../icons";
import type { ComponentProps, MouseEvent, ReactNode } from "react";

import { t } from "@/lib/i18n";
import { useStore, type Bot } from "@/state/store";
import { awayFromMainThread } from "@/state/thread-navigation";
import { BotAvatar } from "./Avatar";
import { Icon } from "./Icon";
import { BOT_PANEL_ID } from "./bot-panel/side-panel";
import { sharedChatAudience } from "./TeamPrivateChatsLine";

/** The factory title a new conversation starts with. */
const UNTITLED = "New thread";

export type ChatHeadPrivacy = { kind: "private" } | { kind: "ownHelper" } | { kind: "shared"; team: string; onlyPeopleAdded?: boolean } | null;

const PRIVACY_ICONS = { private: Lock, ownHelper: UserRound, shared: Users } as const;

function privacyLabelOf(privacy: ChatHeadPrivacy): string | null {
  switch (privacy?.kind) {
    case "private": return t("team.privateHeader");
    case "ownHelper": return t("team.ownHelperHeader");
    case "shared": return sharedChatAudience(privacy.team, privacy.onlyPeopleAdded);
    default: return null;
  }
}

// grok's pill: a half-pixel ink/8 edge; under the pointer or keyboard a 3.5% ink tint, at once
const CHAT_HEAD_PILL = "chat-head-pill group relative isolate flex min-w-0 max-w-full items-center gap-2 rounded-full border-[0.5px] border-transparent bg-composer py-[7.5px] pl-[7.5px] pr-[13.5px] text-ink shadow-(--shadow-float) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus before:pointer-events-none before:absolute before:inset-0 before:-z-10 before:rounded-[inherit] before:bg-ink/[0.035] before:opacity-0 before:content-[''] hover:before:opacity-100 focus-visible:before:opacity-100";


/** A room in the pill: its members' faces where a bot's face goes, its name, and whether its panel is open. */
export interface ChatHeadRoom {
  name: string;
  faces: ReactNode;
  label: string;
  expanded: boolean;
}

/** A bot's chat passes `bot`, `avatar` and `privacy`; a room passes `room` alone. */
interface ChatHeadPillProps {
  bot?: Bot;
  avatar?: Pick<ComponentProps<typeof BotAvatar>, "state" | "motion" | "motionKey" | "animated">;
  privacy?: ChatHeadPrivacy;
  room?: ChatHeadRoom;
  onToggle: (event: MouseEvent<HTMLButtonElement>) => void;
}

/** Simple mode's whole chat header: the bot's face and name in one pill, which opens and closes the bot panel. Away from
 * the bot's main conversation it also names the one on screen; a team chat says who can read it with one quiet glyph.
 * No dot: the sidebar says which of the bot's other conversations need a look. A room's header is the same pill with
 * its members' faces. */
export function ChatHeadPill({ bot, avatar, privacy = null, room, onToggle }: ChatHeadPillProps) {
  const { state } = useStore();
  const open = room ? room.expanded : state.settingsOpen;
  const privacyLabel = privacyLabelOf(privacy);
  const PrivacyIcon = privacy ? PRIVACY_ICONS[privacy.kind] : Users;
  const shown = bot?.tasks?.find((task) => task.threadId === bot.threadId);
  const title = shown?.title;
  // Simple mode calls an untitled conversation what it is, never a "thread"; a teammate's work is never named as one.
  const conversation = !bot ? null : !awayFromMainThread(bot) || shown?.openedBy?.kind === "work" ? (privacy?.kind === "shared" ? t("task.sharedChat") : null)
    : !title || title === UNTITLED ? t("task.untitledConversation") : localizedTaskTitle(title);
  const label = room ? room.label : t("chat.openProfileAria", { name: bot?.name ?? "" });
  return (
    <button
      type="button"
      data-chathead-pill
      data-tour={bot ? "bot-pill" : undefined}
      onClick={onToggle}
      aria-label={conversation ? `${label}, ${conversation}` : label}
      aria-expanded={open}
      aria-controls={open && bot ? BOT_PANEL_ID : undefined}
      className={CHAT_HEAD_PILL}
    >
      {room ? room.faces : bot && <BotAvatar bot={bot} size={24} {...avatar} />}
      <span dir="auto" className="min-w-0 truncate text-[14px] font-medium leading-5">{room ? room.name : bot?.name}</span>
      {conversation && (
        <>
          <Icon name="chevron-right" size={12} className="shrink-0 text-ink/[0.56]" />
          <span data-chathead-conversation dir="auto" className="min-w-0 max-w-[180px] truncate text-[14px] font-medium leading-5 text-ink-secondary">{conversation}</span>
        </>
      )}
      {privacyLabel && (
        <span data-chathead-privacy={privacy?.kind} title={privacyLabel} className="flex shrink-0 text-ink-tertiary">
          <PrivacyIcon size={13} aria-hidden="true" />
          <span className="sr-only">{privacyLabel}</span>
        </span>
      )}
    </button>
  );
}
