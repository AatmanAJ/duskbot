import { t } from "@/lib/i18n";
import { phoneApp } from "@/lib/store-app";
import type { Bot } from "@/state/store";

/** A chat with no messages yet is empty, as Grok Bot's is: the header's pill and the message box say whose chat it is.
 * On a computer only a screen reader hears that nothing has been said; the phone's screen says it, or reads as broken. */
export function EmptyChat({ bot }: { bot: Bot }) {
  if (phoneApp()) {
    return (
      <div className="flex min-h-[60dvh] flex-1 items-center justify-center px-8" data-empty-chat={bot.id}>
        <p role="status" className="text-pretty text-center text-[15px] leading-[22px] text-ink/[0.56]">{t("chat.empty.status")}</p>
      </div>
    );
  }
  return (
    <div className="flex flex-1" data-empty-chat={bot.id}>
      <span role="status" className="sr-only">{t("chat.empty.status")}</span>
    </div>
  );
}
