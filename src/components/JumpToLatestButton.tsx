import type { CSSProperties } from "react";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { Icon } from "./Icon";

export function JumpToLatestButton({ onClick, className, style }: { onClick: () => void; className?: string; style?: CSSProperties }) {
  return (
    <button
      onClick={onClick}
      type="button"
      aria-label={t("chat.jumpToLatestAria")}
      className={cn("chat-jump absolute left-1/2 z-10 flex size-8 -translate-x-1/2 items-center justify-center rounded-full bg-composer text-ink shadow-[0_1px_3px_rgb(28_28_28/0.12)] ring-1 ring-ink/[0.14] transition-colors duration-[120ms] ease-out hover:bg-[color-mix(in_srgb,var(--color-composer),var(--color-ink)_6%)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus", className)}
      style={style}
    >
      <Icon name="arrow-down" size={16} />
    </button>
  );
}
