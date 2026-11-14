// shared pieces for the chat section: the real bubble classes, mascots, a composer replica, timers on the lab's speed
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { BotAvatar } from "@/components/Avatar";
import { SIMPLE_BOT_BUBBLE, SIMPLE_USER_BUBBLE, SIMPLE_STACKED, grokUserBubbleFill } from "@/components/chat-bubble";
import { SIMPLE_COMPOSER } from "@/components/composer-simple";
import { userBubbleStyle } from "@/lib/user-bubble-tone";
import { MAUS_COLORS, type MausColor } from "@/lib/mascot";
import type { MarkState } from "@/components/mascot-engine";
import { ArrowUp } from "@/icons";
import { cn } from "@/lib/cn";
import { ms } from "@lab/tokens";

export type LabBot = { id: string; name: string; color: MausColor };

export const BOTS: LabBot[] = [
  { id: "amy", name: "Amy", color: "pink" },
  { id: "writer", name: "Writer", color: "purple" },
  { id: "pepper", name: "Pepper", color: "orange" },
];
export const AMY = BOTS[0]!;
export const WRITER = BOTS[1]!;

export { SIMPLE_BOT_BUBBLE, SIMPLE_USER_BUBBLE, SIMPLE_STACKED, cn };

/** the bot's mascot, as the transcript draws it */
export function Mascot({ bot, size = 28, state = "idle", animated = true }: { bot: LabBot; size?: number; state?: MarkState; animated?: boolean }) {
  // the avatar takes a whole Bot; the lab only needs what its mascot reads
  const asBot = { id: bot.id, name: bot.name, color: bot.color } as unknown as Parameters<typeof BotAvatar>[0]["bot"];
  return <BotAvatar bot={asBot} size={size} state={state} animated={animated} motion="none" motionKey={0} eyeInk="var(--color-app)" />;
}

/** your own bubble's fill: one flat tone of the bot's colour, grok's own value on the grok skins (ChatView.tsx bubbleStyle) */
export function userFill(color: MausColor): CSSProperties {
  const { backgroundImage: _flat, ...rest } = userBubbleStyle(color, { flat: true });
  const grok = grokUserBubbleFill(color);
  return grok ? ({ ...rest, backgroundColor: `var(--grok-bubble, ${String(rest.backgroundColor)})`, "--grok-bubble-fill": grok } as CSSProperties) : rest;
}

export function UserBubble({ children, bot = AMY, className, style }: { children: ReactNode; bot?: LabBot; className?: string; style?: CSSProperties }) {
  return (
    <div data-chat-bubble="simple" className={cn(SIMPLE_USER_BUBBLE, "chat-text w-fit max-w-[80%] [overflow-wrap:anywhere]", className)} style={{ ...userFill(bot.color), ...style }}>
      {children}
    </div>
  );
}

export function BotBubble({ children, tail = true, className, style }: { children: ReactNode; tail?: boolean; className?: string; style?: CSSProperties }) {
  return (
    <div data-chat-bubble="simple" className={cn(SIMPLE_BOT_BUBBLE, "chat-text w-fit max-w-[85%] [overflow-wrap:anywhere]", tail && "rounded-es-[6px]", className)} style={style}>
      {children}
    </div>
  );
}

/** a row of the transcript: the person's on the right, the bot's on the left */
export function Row({ side, children, className }: { side: "start" | "end"; children: ReactNode; className?: string }) {
  return <div className={cn("flex w-full flex-col", side === "end" ? "items-end" : "items-start", className)}>{children}</div>;
}

/** the transcript column inside a stage: grok's 16px rows, scrolling, pinned to its end */
export function Transcript({ children, className, scrollRef }: { children: ReactNode; className?: string; scrollRef?: React.Ref<HTMLDivElement> }) {
  return (
    <div ref={scrollRef} className={cn("min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-4 [overflow-anchor:none] [scrollbar-width:none]", className)}>
      <div className="flex min-h-full flex-col justify-end gap-4 pt-4 pb-3">{children}</div>
    </div>
  );
}

export function Stage({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("relative flex h-full w-full flex-col overflow-hidden bg-app text-ink", className)}>{children}</div>;
}

/** grok's round send button in the bot's colour, with the composer's real 0.96 press (composer.css) */
export function SendButton({ bot = AMY, onClick, disabled, children, className, label = "Send" }: { bot?: LabBot; onClick?: () => void; disabled?: boolean; children?: ReactNode; className?: string; label?: string }) {
  return (
    <button
      type="button"
      data-composer-send=""
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      style={{ backgroundColor: MAUS_COLORS[bot.color], color: "#fbfbfa" }}
      className={cn("composer-press flex size-8 shrink-0 items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-app disabled:opacity-40", className)}
    >
      {children ?? <ArrowUp size={16} strokeWidth={1.75} absoluteStrokeWidth />}
    </button>
  );
}

/** the composer pill (composer-simple.ts), a plain field and the send button */
export function Composer({ value, onChange, onSend, placeholder, bot = AMY, field, send }: {
  value: string;
  onChange?: (value: string) => void;
  onSend?: () => void;
  placeholder: string;
  bot?: LabBot;
  /** replaces the plain field (a variant drawing its own text layer) */
  field?: ReactNode;
  send?: ReactNode;
}) {
  return (
    <div className="shrink-0 px-4 pb-3">
      <div className={cn(SIMPLE_COMPOSER, "rounded-[22px]")}>
        <div className="flex items-end gap-2">
          <div className="relative min-w-0 flex-1 py-[5px] ps-2">
            {field ?? (
              <input
                aria-label={placeholder}
                className="w-full bg-transparent text-[15px] leading-[22px] text-ink outline-none placeholder:text-ink-tertiary"
                placeholder={placeholder}
                value={value}
                onChange={(e) => onChange?.(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onSend?.(); } }}
              />
            )}
          </div>
          {send ?? <SendButton bot={bot} onClick={onSend} disabled={!value.trim()} />}
        </div>
      </div>
    </div>
  );
}

/** a quiet control above a stage (replay a step, stop a stream) */
export function LabButton({ children, onClick, disabled, pressed }: { children: ReactNode; onClick: () => void; disabled?: boolean; pressed?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={pressed}
      className="rounded-full bg-ink/[0.06] px-2.5 py-1 text-[12px] leading-4 text-ink-secondary transition-colors duration-[120ms] hover:bg-ink/[0.1] hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-40 aria-pressed:bg-ink/[0.12] aria-pressed:text-ink"
    >
      {children}
    </button>
  );
}

export function Controls({ children }: { children: ReactNode }) {
  return <div className="absolute end-2 top-2 z-10 flex gap-1.5">{children}</div>;
}

/** a script of timed steps, restarted on every replay and scaled to the lab's speed */
export function useScript(replayKey: number, speed: number, steps: Array<[at: number, run: () => void]>, deps: unknown[] = []) {
  const live = useRef(steps);
  live.current = steps;
  useEffect(() => {
    const timers = live.current.map(([at, run]) => setTimeout(run, ms(at, speed)));
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replayKey, speed, ...deps]);
}

/** a counter that ticks while `on`, at the lab's speed */
export function useTicker(on: boolean, every: number, speed: number): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!on) return;
    const timer = setInterval(() => setTick((value) => value + 1), ms(every, speed));
    return () => clearInterval(timer);
  }, [on, every, speed]);
  return tick;
}
