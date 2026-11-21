import { useEffect, useRef, useState, type ReactNode, type TdHTMLAttributes, type ThHTMLAttributes } from "react";
import { createPortal } from "react-dom";
import { Check, MoreHorizontal } from "@/icons";
import { Pop } from "./motion";
import { cx } from "./kit";

/** a calm table: no card, quiet grey headers, 14px rows at least 48px tall, hairlines between */
export function Table({ children, label, className }: { children: ReactNode; label: string; className?: string }) {
  return (
    <div className={cx("min-w-0 overflow-x-auto", className)}>
      <table aria-label={label} className="w-full border-collapse text-start text-14">{children}</table>
    </div>
  );
}

export function Th({ className, children, ...rest }: ThHTMLAttributes<HTMLTableCellElement>) {
  return <th scope="col" className={cx("t-meta h-10 whitespace-nowrap px-4 text-start font-medium lowercase first:ps-0", className)} {...rest}>{children}</th>;
}

export function Td({ className, children, ...rest }: TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cx("h-14 px-4 py-2 align-middle text-ink first:ps-0", className)} {...rest}>{children}</td>;
}

/** a dash for a value we do not know */
export const Nil = () => <span className="text-ink-4" aria-label="none">-</span>;

export function SectionHead({ id, children, action, className }: { id?: string; children: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cx("mb-3 flex min-h-10 flex-wrap items-center justify-between gap-3", className)}>
      <h2 id={id} className="text-16 font-medium tracking-[-0.02em] text-ink">{children}</h2>
      {action}
    </div>
  );
}

export interface MenuItem { label: string; onSelect(): void; danger?: boolean; disabled?: boolean; checked?: boolean; lead?: ReactNode }

type MenuSpot = { top?: number; bottom?: number; left?: number; right?: number; maxHeight: number; up: boolean };
const ITEM_H = 36, PAD = 12, GAP = 4, EDGE = 8;

/** where the menu goes: under the button, or above it when the bottom of the window is too close */
function spotFor(button: HTMLElement, count: number, align: "start" | "end"): MenuSpot {
  const r = button.getBoundingClientRect(), vw = window.innerWidth, vh = window.innerHeight;
  const want = count * ITEM_H + PAD, below = vh - r.bottom - GAP - EDGE, above = r.top - GAP - EDGE;
  const up = want > below && above > below;
  const x = align === "end" ? { right: Math.max(EDGE, vw - r.right) } : { left: Math.max(EDGE, r.left) };
  return up ? { ...x, bottom: vh - r.top + GAP, maxHeight: above, up } : { ...x, top: r.bottom + GAP, maxHeight: below, up };
}

/** the "..." button and its menu; the menu sits over the page (no table or scroller can cut it), follows its button on scroll, opens from the button's corner and closes on escape or outside press */
export function RowMenu({ label, items, align = "end", icon, active }: { label: string; items: MenuItem[]; align?: "start" | "end"; icon?: ReactNode; active?: boolean }) {
  const [spot, setSpot] = useState<MenuSpot | null>(null);
  const open = spot !== null;
  const ref = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const close = () => setSpot(null);
  useEffect(() => {
    if (!open) return;
    panel.current?.querySelector<HTMLElement>("[role^=menuitem]:not(:disabled)")?.focus({ preventScroll: true });
    const inside = (target: EventTarget | null) => ref.current?.contains(target as Node) || panel.current?.contains(target as Node);
    const down = (e: PointerEvent) => { if (!inside(e.target)) close(); };
    // the page or a scroller moved: follow the button, and close once it leaves the window
    const scroll = (e: Event) => {
      if (panel.current?.contains(e.target as Node) || !button.current) return;
      const r = button.current.getBoundingClientRect();
      setSpot(r.bottom < 0 || r.top > window.innerHeight ? null : spotFor(button.current, items.length, align));
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") { close(); button.current?.focus(); return; }
      if (e.key === "Tab") { close(); return; }
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      e.preventDefault();
      const all = [...(panel.current?.querySelectorAll<HTMLElement>("[role^=menuitem]:not(:disabled)") ?? [])];
      const at = all.indexOf(document.activeElement as HTMLElement);
      all[(at + (e.key === "ArrowDown" ? 1 : -1) + all.length) % all.length]?.focus();
    };
    document.addEventListener("pointerdown", down);
    document.addEventListener("keydown", key);
    window.addEventListener("scroll", scroll, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("pointerdown", down);
      document.removeEventListener("keydown", key);
      window.removeEventListener("scroll", scroll, true);
      window.removeEventListener("resize", close);
    };
  }, [open, items.length, align]);
  const toggle = () => setSpot((s) => (s || !button.current ? null : spotFor(button.current, items.length, align)));
  // the last place stays while the menu fades out
  const last = useRef<MenuSpot | null>(null);
  if (spot) last.current = spot;
  const { up, maxHeight, ...place } = last.current ?? { up: false, maxHeight: 0 };
  return (
    <div ref={ref} className="relative inline-flex">
      <button ref={button} type="button" aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={toggle} className={cx("hover-ghost grid size-9 shrink-0 place-items-center rounded-full max-sm:size-11", open || active ? "bg-card-2 text-ink" : "text-ink-3")}>
        {icon ?? <MoreHorizontal size={18} strokeWidth={1.5} aria-hidden />}
      </button>
      {createPortal(
        <div ref={panel} className="fixed z-[60]" style={place}>
          <Pop open={open} className={cx("pop min-w-[200px] max-w-[min(320px,calc(100vw-16px))] overflow-y-auto rounded-[16px] bg-pop p-1.5", up ? (align === "end" ? "origin-bottom-right" : "origin-bottom-left") : align === "end" ? "origin-top-right" : "origin-top-left")} style={{ boxShadow: "var(--pop-shadow)", maxHeight }}>
            {items.map((item) => (
              <button key={item.label} type="button" role={item.checked === undefined ? "menuitem" : "menuitemradio"} aria-checked={item.checked} disabled={item.disabled} onClick={() => { close(); button.current?.focus({ preventScroll: true }); item.onSelect(); }} className={cx("hover-ghost flex h-9 w-full items-center justify-between gap-3 rounded-[10px] px-2.5 text-start text-13 outline-none focus-visible:bg-card-2 disabled:opacity-45", item.danger ? "text-bad" : "text-ink-2")}>
                <span className="flex min-w-0 items-center gap-2.5">{item.lead}<span className="truncate">{item.label}</span></span>
                {item.checked && <Check size={15} strokeWidth={1.75} className="shrink-0 text-ink-2" aria-hidden />}
              </button>
            ))}
          </Pop>
        </div>,
        document.body,
      )}
    </div>
  );
}

/** a small status dot after a name; the words go to screen readers and, when it needs attention, on screen too */
export function NameDot({ tone, label }: { tone: "good" | "warn" | "quiet"; label: string }) {
  return <span className={cx("inline-block size-[7px] shrink-0 rounded-[2px]", tone === "good" ? "bg-good" : tone === "warn" ? "bg-warn" : "bg-ink-4")} role="img" aria-label={label} title={label} />;
}
