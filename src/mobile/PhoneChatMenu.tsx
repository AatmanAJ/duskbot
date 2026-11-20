import { MoreHorizontal, Share } from "../icons";
import { currentTaskBot, visibleMessages, type Bot } from "@/state/store";
import { useChatMoreItems } from "@/components/ChatMoreMenu";
import { SidebarPopoverMenu, type SidebarMenuItem } from "@/components/SidebarPopoverMenu";
import { formatTranscriptMarkdown } from "@/lib/export-transcript";
import { t } from "@/lib/i18n";
import { usePlatform } from "./platform";

const PHONE_LABEL: Record<string, Parameters<typeof t>[0]> = { find: "mobile.chat.find", copy: "mobile.chat.copyChat" };

/** The chat menu on a phone: the chat's own actions in phone words, with no keyboard shortcuts, files to download or the
 * profile and computer the header already holds. */
export function phoneChatItems(items: SidebarMenuItem[], share: (() => void) | null): SidebarMenuItem[] {
  const kept = items
    .filter((item) => item.key === "find" || item.key === "model" || item.key === "copy")
    .map((item) => {
      const label = PHONE_LABEL[item.key];
      const phone = { ...item, heading: undefined, separatorBefore: item.key === "copy" };
      return label ? { ...phone, label: t(label), ...(item.key === "find" ? { trailing: undefined } : {}) } : phone;
    });
  if (!share) return kept;
  const copy = kept.find((item) => item.key === "copy");
  return [...kept, { key: "share", label: t("mobile.chat.shareChat"), icon: <Share size={16} />, disabled: copy?.disabled, onSelect: share }];
}

export function PhoneChatMenu({ bot }: { bot: Bot }) {
  const platform = usePlatform();
  const { items } = useChatMoreItems(bot, true);
  const share = platform.share ? () => {
    const thread = currentTaskBot(bot);
    void platform.share!({ title: bot.name, text: formatTranscriptMarkdown({ title: bot.name, messages: visibleMessages(thread), botName: bot.name, isGroup: false }) });
  } : null;
  return (
    <SidebarPopoverMenu
      items={phoneChatItems(items, share)}
      ariaLabel={t("mobile.chat.more")}
      placement="below"
      align="end"
      triggerClassName="pointer-events-auto rounded-full"
      triggerTitle={t("mobile.chat.more")}
      renderTrigger={() => (
        <span data-phone-chat-more="" className="mobile-press m-glass relative inline-flex size-11 items-center justify-center rounded-full text-ink">
          <MoreHorizontal size={20} strokeWidth={1.8} />
        </span>
      )}
    />
  );
}
