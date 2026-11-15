import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion, type Transition } from "motion/react";
import { Icon } from "@/components/Icon";
import { ease, spring } from "@lab/tokens";
import { useLab } from "../shell/prefs";
import type { PageId } from "./model";

export type Route = {
  /** a page from the registry, or a category's list */
  page: PageId | "category" | "home";
  /** the category, provider, app or template it shows */
  id?: string;
  title: string;
  /** data-nav key of the row that opened it, so back can return focus there */
  opener?: string;
};

export const routeKey = (route: Route) => `${route.page}:${route.id ?? ""}`;

export type Nav = {
  stack: Route[];
  top: Route;
  depth: number;
  /** 1 going deeper, -1 coming back, 0 a jump to another branch */
  dir: 1 | -1 | 0;
  /** the last move came from the keyboard: it lands at once */
  keyed: boolean;
  push: (route: Route) => void;
  pop: () => void;
  /** start over at a new branch (a sidebar pick, a search result) */
  reset: (stack: Route[]) => void;
  scroll: Map<string, number>;
};

export function useNavState(home: Route): Nav {
  const [state, setState] = useState<{ stack: Route[]; dir: 1 | -1 | 0 }>({ stack: [home], dir: 0 });
  const scroll = useRef(new Map<string, number>()).current;
  const keyed = useRef(false);
  useEffect(() => {
    const key = (event: KeyboardEvent) => { if (event.key === "Enter" || event.key === " ") keyed.current = true; };
    const point = () => { keyed.current = false; };
    addEventListener("keydown", key, true);
    addEventListener("pointerdown", point, true);
    return () => { removeEventListener("keydown", key, true); removeEventListener("pointerdown", point, true); };
  }, []);
  const opener = () => (document.activeElement instanceof HTMLElement ? document.activeElement.closest<HTMLElement>("[data-nav]")?.dataset.nav : undefined);
  const push = useCallback((route: Route) => {
    const from = opener();
    setState((current) => {
      const depth = current.stack.length;
      scroll.delete(`${depth}:${routeKey(route)}`);
      return { stack: [...current.stack, { ...route, opener: route.opener ?? from }], dir: 1 };
    });
  }, [scroll]);
  const pop = useCallback(() => setState((current) => (current.stack.length > 1 ? { stack: current.stack.slice(0, -1), dir: -1 } : current)), []);
  const reset = useCallback((stack: Route[]) => setState({ stack, dir: 0 }), []);
  return {
    stack: state.stack,
    top: state.stack.at(-1)!,
    depth: state.stack.length - 1,
    dir: state.dir,
    keyed: keyed.current,
    push,
    pop,
    reset,
    scroll,
  };
}

const NavContext = createContext<Nav | null>(null);
const SettledContext = createContext(true);
/** false while the page is still sliding in: shared-element and layout animations wait for it, or they would measure
 * a moving page and fly in from the wrong place */
export const useSettled = () => useContext(SettledContext);
export const NavProvider = NavContext.Provider;
export function useNav(): Nav {
  const nav = useContext(NavContext);
  if (!nav) throw new Error("useNav outside a NavProvider");
  return nav;
}

export type StackLook = "push" | "rise" | "swap";

/** how one page leaves and the next arrives. exits are shorter than entrances and never staggered; reduced motion keeps
 * the fade alone; a keyboard move lands at once */
export function stackVariants(look: StackLook, reduced: boolean, keyed: boolean) {
  const none: Transition = { duration: 0 };
  if (reduced) {
    const fade = keyed ? none : { duration: 0.15, ease: ease.out };
    return {
      enter: { opacity: 0 },
      center: { opacity: 1, x: 0, y: 0, transition: fade },
      exit: { opacity: 0, transition: keyed ? none : { duration: 0.1 } },
    };
  }
  if (look === "push") {
    const push = keyed ? none : { ...spring.push, opacity: { duration: 0.2 } };
    const pop = keyed ? none : { type: "spring", bounce: 0, visualDuration: 0.34 } as const;
    return {
      enter: (dir: number) => (dir >= 0 ? { x: "100%", opacity: 1, zIndex: 2 } : { x: "-30%", opacity: 0.5, zIndex: 0 }),
      center: (dir: number) => ({ x: "0%", opacity: 1, zIndex: dir >= 0 ? 2 : 0, transition: dir >= 0 ? push : pop }),
      exit: (dir: number) => (dir >= 0
        ? { x: "-30%", opacity: 0.5, zIndex: 0, transition: push }
        : { x: "100%", opacity: 1, zIndex: 2, transition: pop }),
    };
  }
  if (look === "rise") {
    return {
      enter: (dir: number) => ({ y: dir >= 0 ? 28 : -10, opacity: 0, filter: "blur(4px)" }),
      center: { y: 0, opacity: 1, filter: "blur(0px)", transition: keyed ? none : { ...spring.soft, opacity: { duration: 0.2 }, filter: { duration: 0.2 } } },
      exit: { opacity: 0, transition: keyed ? none : { duration: 0.12, ease: ease.out } },
    };
  }
  return {
    enter: { y: 8, opacity: 0, filter: "blur(4px)" },
    center: { y: 0, opacity: 1, filter: "blur(0px)", transition: keyed ? none : { duration: 0.22, ease: ease.out } },
    exit: { y: -6, opacity: 0, filter: "blur(2px)", transition: keyed ? none : { duration: 0.12, ease: ease.out } },
  };
}

/** One page of the stack: its own scroller, which remembers where it was and gives focus back to the row that opened
 * the page above it. */
export function Layer({ route, depth, children, className }: { route: Route; depth: number; children: ReactNode; className?: string }) {
  const nav = useNav() as Nav & { lastOpener?: string };
  const scroller = useRef<HTMLDivElement>(null);
  const key = `${depth}:${routeKey(route)}`;
  useLayoutEffect(() => {
    const node = scroller.current;
    if (!node) return;
    node.scrollTop = nav.scroll.get(key) ?? 0;
    // came back here: the row that opened the page above takes focus again
    if (nav.dir === -1 && nav.lastOpener) node.querySelector<HTMLElement>(`[data-nav="${CSS.escape(nav.lastOpener)}"]`)?.focus({ preventScroll: true });
  }, []);
  return (
    <div ref={scroller} className={className ?? "kit-scroll"} onScroll={(event) => nav.scroll.set(key, event.currentTarget.scrollTop)}>
      {children}
    </div>
  );
}

/** The stack inside the panel's one fixed-size box: the top page, and the one leaving while it goes. */
export function Stack({ nav, look, render, className }: {
  nav: Nav;
  look: StackLook;
  render: (route: Route, depth: number) => ReactNode;
  className?: string;
}) {
  const { reduced } = useLab();
  const variants = stackVariants(look, reduced, nav.keyed);
  const lastOpener = useRef<string | undefined>(undefined);
  const prev = useRef(nav.stack);
  if (prev.current !== nav.stack) {
    if (nav.dir === -1) lastOpener.current = prev.current.at(-1)?.opener;
    prev.current = nav.stack;
  }
  const withOpener = useMemo(() => ({ ...nav, lastOpener: lastOpener.current }), [nav]);
  const key = `${nav.depth}:${routeKey(nav.top)}`;
  const [settled, setSettled] = useState(key);
  return (
    <div className={className ?? "kit-stack"}>
      <AnimatePresence initial={false} custom={nav.dir}>
        <motion.div
          key={key}
          className="kit-layer"
          custom={nav.dir}
          variants={variants}
          initial="enter"
          animate="center"
          exit="exit"
          onAnimationComplete={(definition) => definition === "center" && setSettled(key)}
        >
          <SettledContext.Provider value={settled === key || reduced || nav.keyed}>
            <NavProvider value={withOpener}>
              {render(nav.top, nav.depth)}
            </NavProvider>
          </SettledContext.Provider>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

/** A page's header: back to exactly where you were, and the title, which rises in with a slight blur when it changes. */
export function PageHeader({ title, onBack, backLabel = "Back", accent, children }: { title: string; onBack?: () => void; backLabel?: string; accent?: string; children?: ReactNode }) {
  return (
    <header className="kit-header">
      {onBack && (
        <button type="button" className="kit-back" onClick={onBack} aria-label={backLabel} style={accent ? { color: accent } : undefined}>
          <Icon name="chevron-left" size={16} />
          <span className="kit-back-label">{backLabel}</span>
        </button>
      )}
      <SwapText className="kit-title" text={title} as="h2" />
      {children}
    </header>
  );
}

/** Text that changes in place: the new words rise 8px out of a 4px blur, the old ones leave up, faster. */
export function SwapText({ text, className, as = "span" }: { text: string; className?: string; as?: "span" | "h2" | "h3" }) {
  const { reduced } = useLab();
  const Tag = as === "h2" ? motion.h2 : as === "h3" ? motion.h3 : motion.span;
  return (
    <span className="kit-swap">
      <AnimatePresence mode="popLayout" initial={false}>
        <Tag
          key={text}
          className={className}
          initial={reduced ? { opacity: 0 } : { opacity: 0, y: 8, filter: "blur(4px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)", transition: reduced ? { duration: 0.15 } : { duration: 0.22, ease: ease.out } }}
          exit={reduced ? { opacity: 0, transition: { duration: 0.1 } } : { opacity: 0, y: -6, filter: "blur(2px)", transition: { duration: 0.12, ease: ease.out } }}
        >
          {text}
        </Tag>
      </AnimatePresence>
    </span>
  );
}

/** a list that arrives 45ms apart, once, when its page first shows; nothing staggers out */
export function useEnterStagger() {
  const { reduced } = useLab();
  return (index: number) => (reduced
    ? { initial: { opacity: 0 }, animate: { opacity: 1, transition: { duration: 0.15 } } }
    : {
      initial: { opacity: 0, y: 8 },
      animate: { opacity: 1, y: 0, transition: { ...spring.fade, delay: Math.min(index * 0.045, 0.45) } },
    });
}
