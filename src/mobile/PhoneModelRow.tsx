import { createPortal } from "react-dom";
import { ModelPicker } from "@/components/ModelPicker";
import { t } from "@/lib/i18n";
import type { Bot } from "@/state/store";
import { Sheet } from "./Sheet";

/** The bot's model as a phone settings row: Model on the left, the model on the right, and the picker in its own sheet
 * over the bot's. */
export function PhoneModelRow({ bot }: { bot: Bot }) {
  return (
    <ModelPicker
      bot={bot}
      threadId={bot.threadId}
      contained
      className="p-0!"
      label={<span className="block truncate text-[16px] font-medium text-ink">{t("botPanel.page.model")}</span>}
      asRow={{
        className: "mobile-row flex min-h-[52px] w-full items-center gap-3 rounded-[inherit] px-4 py-2 text-left text-ink disabled:opacity-50",
        present: ({ open, close, content }) => createPortal(
          <Sheet open={open} onClose={close} title={t("model.choose")} recede={false}>{content}</Sheet>,
          document.querySelector(".dusk-mobile") ?? document.body,
        ),
      }}
    />
  );
}
