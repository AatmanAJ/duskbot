import { Pin, X } from "../icons";
import type { Bot, Message } from "@/state/store";
import { t } from "@/lib/i18n";
import { peerLine } from "@/lib/peer-message";
import { withoutCitationMarkers } from "@/lib/citations";
import { ComposerNoticeSlot } from "./ComposerNoticeSlot";

type BannerProps = {
  bot: Bot;
  pinnedId?: string;
  messages: Message[];
  onJump: (messageId: string) => void;
  onUnpin?: () => void;
};

/** The chat's pinned message above the transcript: who said it, a one-line preview that jumps to it, and Unpin. It comes
 * and goes as the notices above the composer do; another chat opens with its own at once. */
export function PinnedBanner(props: BannerProps) {
  return (
    <ComposerNoticeSlot key={props.bot.threadId}>
      <div><Banner {...props} /></div>
    </ComposerNoticeSlot>
  );
}

function Banner({
  bot,
  pinnedId,
  messages,
  onJump,
  onUnpin,
}: BannerProps) {
  const pinned = messages.find((m) => m.id === pinnedId);
  if (!pinned || pinned.kind !== "text") return null;
  const pinnedPeer = peerLine(pinned);
  const sender =
    pinned.role === "user" ? (pinnedPeer?.name ?? t("chat.you")) : (pinned.from?.name ?? bot.name);
  const text = withoutCitationMarkers(pinnedPeer?.body ?? pinned.text ?? "").replace(/\s+/g, " ").trim();
  if (!text) return null;
  return (
    <div className="w-full px-5">
      <div data-pinned-banner="" className="mb-2 flex min-h-8 items-center gap-2 rounded-[14px] bg-composer py-1 pe-1 ps-3 ring-[0.5px] ring-transparent">
        <Pin size={12} aria-hidden="true" className="shrink-0 text-ink-tertiary" />
        <button
          onClick={() => onJump(pinned.id)}
          className="flex min-w-0 flex-1 items-baseline gap-2 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
          title={t("chat.pinnedJump")}
        >
          <span className="shrink-0 text-[12px] font-medium leading-4 text-ink">{sender}</span>
          <span dir="auto" className="truncate text-[13px] text-ink-secondary">{text}</span>
        </button>
        {onUnpin && <button
          onClick={onUnpin}
          aria-label={t("chat.unpinMessage")}
          title={t("chat.unpin")}
          className="flex size-6 shrink-0 items-center justify-center rounded-full text-ink-tertiary transition-colors hover:bg-ink/[0.06] hover:text-ink-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus pointer-coarse:size-9"
        >
          <X size={12} aria-hidden="true" />
        </button>}
      </div>
    </div>
  );
}
