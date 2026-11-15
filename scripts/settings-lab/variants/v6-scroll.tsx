// 6. Scroll: every setting on one long page. Each category keeps a sticky coloured header while you are in it, and the
// index at the top follows the scroll with a stretchy highlight. A page you open rises over the list; back drops you at
// the same spot.
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { motion } from "motion/react";
import "./v6-scroll.css";
import { useStretch } from "@/lib/use-stretch";
import { useLab } from "../shell/prefs";
import {
  CATEGORIES, CategoryBody, CategoryIcon, Layer, NavProvider, PageBody, PageHeader, Stack, hueVar, useNavState, type Route,
} from "@kit/index";

export default function Scroll() {
  const nav = useNavState({ page: "home", title: "Settings" });
  return (
    <NavProvider value={nav}>
      <div className="v6">
        <Stack
          nav={nav}
          look="rise"
          render={(route, depth) => (depth === 0
            ? <Home route={route} />
            : (
              <>
                <PageHeader title={route.title} onBack={nav.pop} backLabel={nav.stack[depth - 1]!.title} />
                <Layer route={route} depth={depth}><PageBody route={route} /></Layer>
              </>
            ))}
        />
      </div>
    </NavProvider>
  );
}

const LAST = CATEGORIES.at(-1)!.id;

function Home({ route }: { route: Route }) {
  const { reduced } = useLab();
  const [active, setActive] = useState(CATEGORIES[0]!.id);
  const inner = useRef<HTMLDivElement>(null);
  // a chip's own scroll owns the highlight until it lands, so it doesn't stop at every category on the way
  const lock = useRef(false);
  const keyed = useRef(false);

  useEffect(() => {
    const root = inner.current?.closest<HTMLElement>(".kit-scroll");
    if (!root) return;
    const seen = new Map<string, boolean>();
    const pick = () => {
      if (lock.current) return;
      if (seen.get("__end")) return setActive(LAST);
      const first = CATEGORIES.find((entry) => seen.get(entry.id));
      if (first) setActive(first.id);
    };
    const band = new IntersectionObserver((entries) => {
      for (const entry of entries) seen.set((entry.target as HTMLElement).dataset.block!, entry.isIntersecting);
      pick();
    }, { root, rootMargin: "0px 0px -78% 0px", threshold: 0 });
    const end = new IntersectionObserver((entries) => {
      for (const entry of entries) seen.set("__end", entry.isIntersecting);
      pick();
    }, { root, threshold: 1 });
    root.querySelectorAll<HTMLElement>("[data-block]").forEach((node) => band.observe(node));
    const sentinel = root.querySelector<HTMLElement>("[data-end]");
    if (sentinel) end.observe(sentinel);
    const landed = () => { lock.current = false; };
    root.addEventListener("scrollend", landed);
    return () => { band.disconnect(); end.disconnect(); root.removeEventListener("scrollend", landed); };
  }, []);

  const go = (id: string) => {
    const root = inner.current?.closest<HTMLElement>(".kit-scroll");
    const block = root?.querySelector<HTMLElement>(`[data-block="${id}"]`);
    if (!root || !block) return;
    const instant = keyed.current || reduced;
    setActive(id);
    lock.current = true;
    root.scrollTo({ top: block.offsetTop, behavior: instant ? "instant" : "smooth" });
    window.setTimeout(() => { lock.current = false; }, instant ? 50 : 1200);
    if (instant) block.querySelector<HTMLElement>("button, [href], input")?.focus({ preventScroll: true });
  };

  return (
    <>
      <div className="v6-top">
        <h2 className="v6-big">Settings</h2>
        <Index active={active} instant={reduced || keyed.current} onPick={go} keyed={keyed} />
      </div>
      <Layer route={route} depth={0}>
        <div ref={inner}>
          {CATEGORIES.map((entry) => (
            <section key={entry.id} data-block={entry.id} className="v6-block" style={{ "--v6-hue": hueVar(entry.hue) } as CSSProperties} aria-labelledby={`v6-${entry.id}`}>
              <h3 className="v6-head" id={`v6-${entry.id}`}>
                <CategoryIcon hue={entry.hue} icon={entry.icon} size={26} look="solid" />
                <span>{entry.title}</span>
                <span className="v6-head-blurb">{entry.blurb}</span>
              </h3>
              <CategoryBody id={entry.id} />
            </section>
          ))}
          <div data-end="" className="v6-end">That's everything. dusk bot saves each change as you make it.</div>
        </div>
      </Layer>
    </>
  );
}

/** the category index: its highlight stretches toward the next pick (front edge stiff, back edge catching up) and lands
 * at once under reduced motion or the keyboard */
function Index({ active, instant, onPick, keyed }: { active: string; instant: boolean; onPick: (id: string) => void; keyed: React.RefObject<boolean> }) {
  const track = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ start: number; end: number } | null>(null);
  useLayoutEffect(() => {
    const node = track.current;
    const chip = node?.querySelector<HTMLElement>(`[data-chip="${active}"]`);
    if (!node || !chip) return;
    setBox({ start: chip.offsetLeft, end: chip.offsetLeft + chip.offsetWidth });
    const left = chip.offsetLeft - 28;
    const right = chip.offsetLeft + chip.offsetWidth + 28 - node.clientWidth;
    const behavior = instant ? "instant" : "smooth";
    if (left < node.scrollLeft) node.scrollTo({ left, behavior });
    else if (right > node.scrollLeft) node.scrollTo({ left: right, behavior });
  }, [active, instant]);
  const stretch = useStretch(box, instant);
  const hue = hueVar(CATEGORIES.find((entry) => entry.id === active)!.hue);
  return (
    <nav aria-label="Jump to a category" className="v6-index" ref={track}>
      <motion.span aria-hidden="true" className="v6-pill" style={{ x: stretch.start, width: stretch.size, "--v6-hue": hue } as never} />
      {CATEGORIES.map((entry) => (
        <button
          key={entry.id}
          type="button"
          data-chip={entry.id}
          className="v6-chip"
          aria-current={entry.id === active ? "true" : undefined}
          style={{ "--v6-hue": hueVar(entry.hue) } as CSSProperties}
          onPointerDown={() => { keyed.current = false; }}
          onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") keyed.current = true; }}
          onClick={() => onPick(entry.id)}
        >
          <CategoryIcon hue={entry.hue} icon={entry.icon} size={24} look="bare" className="v6-chip-icon" />
          {entry.title}
        </button>
      ))}
    </nav>
  );
}
