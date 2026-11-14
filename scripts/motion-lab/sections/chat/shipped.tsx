// what ships today, built from the real pieces: rowEnter (use-arrival-flow.ts) and TurnPresence's simple line classes
import { useLayoutEffect, useRef, type ReactNode } from "react";
import { rowEnter } from "@/hooks/use-arrival-flow";
import { t } from "@/lib/i18n";
import { cn, Mascot, type LabBot } from "./kit";
import type { MarkState } from "@/components/mascot-engine";

/** a transcript row arriving while the chat is open: the real 12px / 240ms rise, no fade (reduced: it just appears) */
export function Arrive({ children, reduced, className, side = "start" }: { children: ReactNode; reduced: boolean; className?: string; side?: "start" | "end" }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!reduced && ref.current) rowEnter(ref.current);
  }, [reduced]);
  return <div ref={ref} className={cn("flex w-full flex-col", side === "end" ? "items-end" : "items-start", className)}>{children}</div>;
}

/** TurnPresence in simple mode: the mark pops, the row grows from its leading edge, the label rises 4px and shimmers */
export function StatusLine({ bot, state, label, leaving = false }: { bot: LabBot; state: MarkState; label?: string | null; leaving?: boolean }) {
  return (
    <div className="turn-presence flex min-w-0 max-w-full flex-col items-start">
      <div className={cn("flex h-9 min-w-0 max-w-full items-center gap-[8.5px] ps-2", leaving ? "turn-status-out" : "turn-status-in")}>
        <span className="turn-status-mark relative top-px inline-flex shrink-0"><Mascot bot={bot} size={28} state={state} /></span>
        <span className="turn-label-slot flex h-[22px] min-w-0 items-center gap-x-1.5 text-[14px] leading-[22px]" data-turn-status>
          <span className="grid min-w-0">
            {label && (
              <span key={label} className="turn-label-in flex min-w-0 items-center [grid-area:1/1]">
                <span className="status-shimmer">{label}</span>
              </span>
            )}
          </span>
        </span>
      </div>
    </div>
  );
}

export const TYPING = () => t("chat.typing");
