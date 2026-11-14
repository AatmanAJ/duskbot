import { useLayoutEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Icon, type IconName } from "@/components/Icon";
import { cn } from "@/lib/cn";
import { GROK_LABEL, GROK_ROW_FILL, MENU_ITEM_SEPARATOR, MENU_SHEET } from "@/components/menu-recipe";
import { dur, ease, ms, spring, stagger } from "@lab/tokens";
import type { LabProps } from "@lab/types";
import { useLater, useScript, useStretch } from "./kit";

type Row = { key: string; label: string; icon: IconName; subtitle?: string; submenu?: Row[]; separatorBefore?: boolean };

const SUPPORT: Row[] = [
  { key: "help", label: "Help", icon: "question-circle" },
  { key: "shortcuts", label: "Keyboard shortcuts", icon: "keyboard" },
  { key: "feedback", label: "Send feedback", icon: "mail" },
  { key: "about", label: "About dusk bot", icon: "info" },
];
const ROWS: Row[] = [
  { key: "mobile", label: "Connect your phone", icon: "device-mobile" },
  { key: "support", label: "Support", icon: "book", submenu: SUPPORT },
  { key: "settings", label: "Settings", icon: "gear" },
  { key: "who", label: "Riya Kapoor", subtitle: "riya@studio.dev", icon: "person", separatorBefore: true },
  { key: "log-out", label: "Log out", icon: "arrow-bracket-from-left" },
];

/** submenu intent as lib/submenu-intent: a row opens its submenu after a 100ms dwell; leaving the menu closes it after 300ms */
function useMenuDemo({ replayKey, speed }: LabProps) {
  const [open, setOpen] = useState(false);
  const [sub, setSub] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const later = useLater(speed);
  const dwell = useRef<(() => void) | null>(null);
  const enter = (row: Row) => {
    setHover(row.key);
    dwell.current?.();
    dwell.current = later(100, () => setSub(row.submenu ? row.key : null));
  };
  const leaveMenu = () => {
    dwell.current?.();
    dwell.current = later(300, () => setSub(null));
  };
  const close = () => { setOpen(false); setSub(null); setHover(null); };
  const stop = useScript(replayKey, speed, [
    [500, () => setOpen(true)], [500, () => setHover("mobile")], [350, () => enter(ROWS[1]!)], [700, () => setHover("help")],
    [300, () => setHover("shortcuts")], [300, () => setHover("feedback")], [700, () => enter(ROWS[2]!)], [800, close],
  ], close);
  return {
    open, sub, hover,
    toggle: () => { stop(); if (open) close(); else setOpen(true); },
    enter: (row: Row) => { stop(); enter(row); },
    hoverSub: (key: string | null) => { stop(); dwell.current?.(); setHover(key); },
    leaveMenu: () => { stop(); setHover(null); leaveMenu(); },
    clickRow: (row: Row) => { stop(); if (row.submenu) setSub(sub === row.key ? null : row.key); else close(); },
  };
}
type Demo = ReturnType<typeof useMenuDemo>;

function useMount(open: boolean, speed: number, exitMs: number) {
  const [mounted, setMounted] = useState(open);
  useLayoutEffect(() => {
    if (open) { setMounted(true); return; }
    if (!mounted) return;
    const timer = window.setTimeout(() => setMounted(false), ms(exitMs, speed));
    return () => window.clearTimeout(timer);
  }, [open, mounted, speed, exitMs]);
  return { shown: open || mounted, closing: !open && mounted };
}

/** grok's row: an 18px slot for a 14px glyph, 6px before the label, the fill drawn on ::before */
function MenuRow({ row, demo, inSub, forced, plainFill = true }: { row: Row; demo: Demo; inSub?: boolean; forced?: boolean; plainFill?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5" data-menu-row={row.key}>
      {row.separatorBefore && <div role="separator" className={MENU_ITEM_SEPARATOR} />}
      <button
        type="button"
        role="menuitem"
        aria-haspopup={row.submenu ? "menu" : undefined}
        aria-expanded={row.submenu ? demo.sub === row.key : undefined}
        onPointerEnter={() => (inSub ? demo.hoverSub(row.key) : demo.enter(row))}
        onClick={() => demo.clickRow(row)}
        className={cn("flex min-h-8 w-full items-center gap-1.5 px-2 py-1.5 text-start text-[14px] leading-5 tracking-[0.01em] text-ink focus-visible:outline-none",
          plainFill ? GROK_ROW_FILL : "relative focus-visible:bg-menu-hover rounded-[10px]",
          plainFill && (forced || (row.submenu && demo.sub === row.key)) && "before:bg-menu-hover")}
      >
        <span className="flex size-[18px] shrink-0 items-center justify-center text-ink/[0.66]">
          {row.key === "who" ? <span className="flex size-4 items-center justify-center rounded-full bg-[#7c6cf0] text-[9px] font-semibold text-white">R</span> : <Icon name={row.icon} size={14} />}
        </span>
        {row.subtitle ? (
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate">{row.label}</span>
            <span className="truncate text-[12px] leading-4 text-ink-secondary">{row.subtitle}</span>
          </span>
        ) : <span className={cn("flex-1 truncate", GROK_LABEL)}>{row.label}</span>}
        {row.submenu && <Icon name="chevron-right" size={14} className="ms-2 shrink-0 text-ink/[0.52]" />}
      </button>
    </div>
  );
}

/** the sidebar foot: the account button; the menu opens above it and Support's submenu to its right */
function MenuStage({ demo, children }: { demo: Demo; children: React.ReactNode }) {
  return (
    <div className="relative h-full w-full">
      <div className="absolute inset-y-0 left-0 w-[46%] bg-sidebar/60" aria-hidden />
      <button type="button" aria-haspopup="menu" aria-expanded={demo.open} onClick={demo.toggle}
        className="absolute bottom-3 left-3 flex h-9 items-center gap-2 rounded-[10px] px-2 text-[14px] text-ink hover:bg-ink/[0.06] focus-visible:outline-2 focus-visible:outline-focus">
        <span className="flex size-6 items-center justify-center rounded-full bg-[#7c6cf0] text-[11px] font-semibold text-white">R</span>
        Riya
      </button>
      {children}
    </div>
  );
}

const MENU_POS = "absolute bottom-[52px] left-3 w-[200px]";
const SUB_TOP_OFFSET = 46;

/* ---------------- Original ---------------- */

export function MenuOriginal(props: LabProps) {
  const demo = useMenuDemo(props);
  const mount = useMount(demo.open, props.speed, 150);
  const support = ROWS[1]!;
  return (
    <MenuStage demo={demo}>
      {mount.shown && (
        <div className={MENU_POS} onPointerLeave={demo.leaveMenu}>
        <div role="menu" aria-label="account"
          style={{ transformOrigin: "40px 100%", ["--menu-shift" as string]: "4px" }}
          className={cn(MENU_SHEET, "w-full overflow-hidden", mount.closing ? "animate-pop-out pointer-events-none" : "animate-pop-in")}>
          {ROWS.map((row) => <MenuRow key={row.key} row={row} demo={demo} forced={demo.hover === row.key} />)}
        </div>
          {demo.sub && !mount.closing && (
            <div role="menu" aria-label="support" className={cn(MENU_SHEET, "absolute left-[calc(100%+4px)] w-[178px]")} style={{ top: SUB_TOP_OFFSET - 6 }}>
              {support.submenu!.map((row) => <MenuRow key={row.key} row={row} demo={demo} inSub forced={demo.hover === row.key} />)}
            </div>
          )}
        </div>
      )}
    </MenuStage>
  );
}

/* ---------------- A: calm ---------------- */

export function MenuA(props: LabProps) {
  const demo = useMenuDemo(props);
  const support = ROWS[1]!;
  return (
    <MenuStage demo={demo}>
      <AnimatePresence>
        {demo.open && (
          <motion.div key="menu" role="menu" aria-label="account" onPointerLeave={demo.leaveMenu} style={{ transformOrigin: "40px 100%" }}
            className={cn(MENU_SHEET, MENU_POS)}
            initial={{ opacity: 0, scale: 0.97, y: 4 }} animate={{ opacity: 1, scale: 1, y: 0, transition: { duration: dur.fast, ease: ease.out } }}
            exit={{ opacity: 0, transition: { duration: 0.1, ease: ease.out } }}>
            {ROWS.map((row) => <MenuRow key={row.key} row={row} demo={demo} forced={demo.hover === row.key} />)}
            <AnimatePresence>
              {demo.sub && (
                <motion.div key="sub" role="menu" aria-label="support" className={cn(MENU_SHEET, "absolute left-[calc(100%+4px)] w-[178px]")} style={{ top: SUB_TOP_OFFSET - 6 }}
                  initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0, transition: { duration: dur.d120, ease: ease.out } }}
                  exit={{ opacity: 0, transition: { duration: dur.d75 } }}>
                  {support.submenu!.map((row) => <MenuRow key={row.key} row={row} demo={demo} inSub forced={demo.hover === row.key} />)}
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>
    </MenuStage>
  );
}

/* ---------------- B: alive ---------------- */

/** one fill that stretches from row to row: the edge facing the move leads, the other catches up */
function SlidingFill({ container, hoverKey, rows }: { container: React.RefObject<HTMLDivElement | null>; hoverKey: string | null; rows: string[] }) {
  const [box, setBox] = useState<{ start: number; end: number } | null>(null);
  useLayoutEffect(() => {
    const root = container.current;
    const button = root && hoverKey && rows.includes(hoverKey) ? root.querySelector<HTMLElement>(`[data-menu-row="${hoverKey}"] button`) : null;
    if (!root || !button) { setBox(null); return; }
    let top = 0;
    for (let el: HTMLElement | null = button; el && el !== root; el = el.offsetParent as HTMLElement | null) top += el.offsetTop;
    const end = top + button.offsetHeight;
    setBox((last) => (last && last.start === top && last.end === end ? last : { start: top, end }));
  }, [container, hoverKey, rows.join()]);
  const stretch = useStretch(box);
  return (
    <motion.span aria-hidden className="pointer-events-none absolute inset-x-1.5 rounded-[10px] bg-menu-hover"
      style={{ top: stretch.start, height: stretch.size }}
      initial={false} animate={{ opacity: box ? 1 : 0 }} transition={{ duration: dur.d120 }} />
  );
}

export function MenuB(props: LabProps) {
  const demo = useMenuDemo(props);
  const support = ROWS[1]!;
  const menuRef = useRef<HTMLDivElement>(null);
  const subRef = useRef<HTMLDivElement>(null);
  const keys = ROWS.map((r) => r.key);
  const subKeys = SUPPORT.map((r) => r.key);
  const hoverInMenu = demo.hover && keys.includes(demo.hover) ? demo.hover : demo.sub;
  return (
    <MenuStage demo={demo}>
      <AnimatePresence>
        {demo.open && (
          <motion.div key="wrap" className={MENU_POS} onPointerLeave={demo.leaveMenu} exit={{ opacity: 0, transition: { duration: 0.1, ease: ease.out } }}>
          <motion.div ref={menuRef} role="menu" aria-label="account"
            className={cn(MENU_SHEET, "isolate w-full")}
            initial={{ opacity: 0, clipPath: "inset(60% 0% 0% 0% round 14px)", y: 4 }}
            animate={{ opacity: 1, clipPath: "inset(0% 0% 0% 0% round 14px)", y: 0, transition: { clipPath: spring.height, y: spring.height, opacity: { duration: dur.fast } } }}
            >
            <SlidingFill container={menuRef} hoverKey={hoverInMenu} rows={keys} />
            {ROWS.map((row, i) => (
              <motion.div key={row.key} className="relative z-[1]"
                initial={props.reduced ? false : { opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0, transition: { ...spring.fade, delay: (ROWS.length - 1 - i) * stagger.in } }}>
                <MenuRow row={row} demo={demo} plainFill={false} />
              </motion.div>
            ))}
          </motion.div>
            <AnimatePresence>
              {demo.sub && (
                <motion.div key="sub" ref={subRef} role="menu" aria-label="support" className={cn(MENU_SHEET, "absolute left-[calc(100%+4px)] isolate w-[178px]")}
                  style={{ top: SUB_TOP_OFFSET - 6, transformOrigin: "0 20px" }}
                  initial={{ opacity: 0, x: -6, scale: 0.97, filter: "blur(2px)" }}
                  animate={{ opacity: 1, x: 0, scale: 1, filter: "blur(0px)", transition: spring.fade }}
                  exit={{ opacity: 0, transition: { duration: dur.d75 } }}>
                  <SlidingFill container={subRef} hoverKey={demo.hover} rows={subKeys} />
                  {support.submenu!.map((row) => <div key={row.key} className="relative z-[1]"><MenuRow row={row} demo={demo} inSub plainFill={false} /></div>)}
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>
    </MenuStage>
  );
}
