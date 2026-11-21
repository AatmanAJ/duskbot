import type { CSSProperties } from "react";
import { t } from "@/lib/i18n";
import { UNREAD_DIVIDER_FADE_MS } from "@/lib/unread-divider";
import { cn } from "@/lib/cn";
import { phoneApp } from "@/lib/store-app";

/**
 * grok's "New" line: 1px rules in the accent at 20%, the word in the accent. `tint` is the bot's colour, when the chat
 * wears it; on the grok skins `grokTint`, grok's own text colour for the bot's hue, wins as it does in grok.
 */
export function NewMessagesDivider({ fading, tint, grokTint }: { fading: boolean; tint?: string; grokTint?: string }) {
  return (
    <div
      role="separator"
      aria-label={t("chat.newMessagesAria")}
      data-unread-divider
      className={cn(
        "grid ease-out transition-[grid-template-rows,opacity,margin-bottom] motion-reduce:transition-none",
        fading && !phoneApp() ? "-mb-3 grid-rows-[0fr] opacity-0" : "mt-1 mb-2 grid-rows-[1fr]",
        fading ? "opacity-0" : "opacity-100",
      )}
      style={{
        transitionDuration: `${UNREAD_DIVIDER_FADE_MS}ms`,
        "--new-ink": `var(--grok-new, ${tint ?? "var(--color-accent-text)"})`,
        ...(grokTint ? { "--grok-new-fill": grokTint } : {}),
      } as CSSProperties}
    >
      <div className="min-h-0 overflow-hidden">
        <div aria-hidden="true" className="animate-msg-in flex items-center gap-2 py-0.5">
          <span className="h-px min-w-0 flex-1 basis-0 bg-(--new-ink)/20" />
          <span className="shrink-0 text-[11px] font-medium uppercase leading-4 tracking-[0.01em] text-(--new-ink)">
            {t("chat.newMessages")}
          </span>
          <span className="h-px min-w-0 flex-1 basis-0 bg-(--new-ink)/20" />
        </div>
      </div>
    </div>
  );
}
