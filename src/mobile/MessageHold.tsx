import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { t } from "@/lib/i18n";
import { ContextMenu, holdSink, type ContextAction, type ContextReaction } from "./ContextMenu";
import { haptic } from "./haptics";

const HOLD_MS = 400;
const MOVE_CANCEL = 8;
const BUBBLE = "[data-mobile-chat] [data-message-row] [data-chat-bubble]";

type Held = { bubble: HTMLElement; rect: DOMRect; radius: string; end: boolean; actions: ContextAction[]; reactions: ContextReaction[] };

/** React commits a click's state on a microtask; a few turns are enough, a frame at most. */
async function settle<T>(read: () => T | null): Promise<T | null> {
  for (let i = 0; i < 4; i++) {
    await Promise.resolve();
    const value = read();
    if (value) return value;
  }
  await new Promise((resolve) => requestAnimationFrame(resolve));
  return read();
}

const iconOf = (button: Element): Node | null => button.querySelector("svg")?.cloneNode(true) ?? null;

function Icon({ node }: { node: Node | null }) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !node) return;
    el.replaceChildren(node.cloneNode(true));
  }, [node]);
  return <span ref={ref} className="flex size-[18px] items-center justify-center [&>svg]:size-[18px]" />;
}

/** What a message offers, read from its own action bar (reply, the "..." menu, the reaction picker) so the phone's
 * menu always matches it; choosing one presses that same control. The bar is hidden while it is read, so nothing
 * flashes behind the menu. */
export async function readMessageActions(row: HTMLElement): Promise<{ actions: ContextAction[]; reactions: ContextReaction[] }> {
  const bar = row.querySelector<HTMLElement>("[data-testid='message-actions']");
  if (!bar) return { actions: [], reactions: [] };
  const hide = <R,>(run: () => Promise<R>) => async () => { bar.style.visibility = "hidden"; try { return await run(); } finally { bar.style.visibility = ""; } };
  const buttons = [...bar.querySelectorAll<HTMLButtonElement>(":scope > button, :scope > div > button")];
  const react = buttons.find((button) => button.getAttribute("aria-label") === t("chat.react"));
  const more = buttons.find((button) => button.getAttribute("aria-label") === t("chat.messageActions"));
  const actions: ContextAction[] = [];
  const reactions: ContextReaction[] = [];
  for (const button of buttons) {
    if (button === react || button === more) continue;
    const label = button.getAttribute("aria-label");
    if (!label) continue;
    const icon = iconOf(button);
    actions.push({ key: `bar:${label}`, label, icon: <Icon node={icon} />, onSelect: () => button.click() });
  }
  await hide(async () => {
    if (more) {
      more.click();
      const items = await settle(() => { const found = [...bar.querySelectorAll<HTMLButtonElement>("[role='menuitem']")]; return found.length ? found : null; });
      for (const [index, item] of (items ?? []).entries()) {
        const label = item.textContent?.trim() ?? "";
        if (!label) continue;
        const icon = iconOf(item);
        actions.push({
          key: `menu:${index}:${label}`,
          label,
          disabled: item.disabled,
          icon: <Icon node={icon} />,
          onSelect: () => void hide(async () => {
            more.click();
            const again = await settle(() => [...bar.querySelectorAll<HTMLButtonElement>("[role='menuitem']")].find((one) => one.textContent?.trim() === label) ?? null);
            again?.click();
          })(),
        });
      }
      if (items) more.click();
    }
    if (react) {
      react.click();
      const choices = await settle(() => { const found = [...bar.querySelectorAll<HTMLButtonElement>("[role='toolbar'] button")]; return found.length ? found : null; });
      for (const choice of choices ?? []) {
        const label = choice.getAttribute("aria-label") ?? "";
        reactions.push({ key: label, label, glyph: choice.textContent?.trim() ?? "", selected: choice.getAttribute("aria-pressed") === "true" });
      }
      if (choices) react.click();
    }
    await settle(() => true);
  })();
  return { actions, reactions };
}

export function pickReaction(row: HTMLElement, label: string): void {
  const bar = row.querySelector<HTMLElement>("[data-testid='message-actions']");
  const react = bar && [...bar.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.getAttribute("aria-label") === t("chat.react"));
  if (!bar || !react) return;
  bar.style.visibility = "hidden";
  react.click();
  void settle(() => [...bar.querySelectorAll<HTMLButtonElement>("[role='toolbar'] button")].find((one) => one.getAttribute("aria-label") === label) ?? null)
    .then((choice) => { choice?.click(); })
    .finally(() => { bar.style.visibility = ""; });
}

function Preview({ bubble, width }: { bubble: HTMLElement; width: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const host = ref.current;
    if (!host) return;
    const copy = bubble.cloneNode(true) as HTMLElement;
    copy.removeAttribute("id");
    for (const el of copy.querySelectorAll("[id]")) el.removeAttribute("id");
    copy.style.width = `${width}px`;
    copy.style.maxWidth = "none";
    copy.style.margin = "0";
    copy.style.visibility = "visible";
    host.replaceChildren(copy);
  }, [bubble, width]);
  return <div ref={ref} className="pointer-events-none" />;
}

/** Press and hold a message: it sinks under the finger, then lifts out of the blurred chat with its reactions over it
 * and its actions under it, as iMessage does. */
export function MessageHold({ rootRef }: { rootRef: RefObject<HTMLElement | null> }) {
  const [held, setHeld] = useState<Held | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let timer = 0;
    let start: { x: number; y: number } | null = null;
    let fired = false;
    let sink: ((on: boolean | null) => void) | null = null;
    const cancel = () => { window.clearTimeout(timer); timer = 0; start = null; sink?.(false); sink = null; };
    const onTouchStart = (event: TouchEvent) => {
      fired = false;
      if (event.touches.length !== 1) { cancel(); return; }
      const target = event.target instanceof Element ? event.target : null;
      const bubble = target?.closest<HTMLElement>(BUBBLE);
      if (!bubble || target?.closest("button, input, textarea, [contenteditable='true'], [aria-hidden='true']")) return;
      const row = bubble.closest<HTMLElement>("[data-message-row]");
      if (!row?.querySelector("[data-testid='message-actions']")) return;
      start = { x: event.touches[0].clientX, y: event.touches[0].clientY };
      sink = holdSink(bubble);
      sink(true);
      timer = window.setTimeout(async () => {
        timer = 0;
        fired = true;
        sink?.(null);
        sink = null;
        // the bar's own long press would also bring up its pill
        row.dispatchEvent(new PointerEvent("pointercancel", { bubbles: true, pointerType: "touch" }));
        haptic("medium");
        const rect = bubble.getBoundingClientRect();
        const { actions, reactions } = await readMessageActions(row);
        if (!actions.length && !reactions.length) return;
        setHeld({ bubble, rect, radius: getComputedStyle(bubble).borderRadius, end: row.classList.contains("items-end"), actions, reactions });
        setOpen(true);
      }, HOLD_MS);
    };
    const onTouchMove = (event: TouchEvent) => {
      if (!start || !timer) return;
      const touch = event.touches[0];
      if (Math.hypot(touch.clientX - start.x, touch.clientY - start.y) > MOVE_CANCEL) cancel();
    };
    const onTouchEnd = (event: TouchEvent) => {
      if (fired && event.cancelable) event.preventDefault();
      cancel();
    };
    root.addEventListener("touchstart", onTouchStart, { passive: true });
    root.addEventListener("touchmove", onTouchMove, { passive: true });
    root.addEventListener("touchend", onTouchEnd);
    root.addEventListener("touchcancel", cancel);
    return () => {
      cancel();
      root.removeEventListener("touchstart", onTouchStart);
      root.removeEventListener("touchmove", onTouchMove);
      root.removeEventListener("touchend", onTouchEnd);
      root.removeEventListener("touchcancel", cancel);
    };
  }, [rootRef]);

  const close = useCallback(() => setOpen(false), []);
  const row = held?.bubble.closest<HTMLElement>("[data-message-row]") ?? null;
  return (
    <ContextMenu
      open={open && Boolean(held)}
      anchor={held?.rect ?? null}
      label={t("chat.messageActions")}
      preview={held ? <Preview bubble={held.bubble} width={held.rect.width} /> : null}
      radius={held?.radius}
      actions={held?.actions ?? []}
      reactions={held?.reactions.length ? held.reactions : undefined}
      onReact={(label) => { if (row) pickReaction(row, label); }}
      end={held?.end}
      source={held?.bubble}
      onClose={close}
    />
  );
}
