// 4. Sidebar: a short rail of coloured categories and one content side. The rail's highlight stretches to the new row
// (front edge stiff, back edge catching up) and takes the row's colour; the content swaps with a small rise. Pages
// inside a category push over the right side only, so the rail never moves and back returns to where you were.
import { useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { AnimatePresence, motion } from "motion/react";
import "./v4-sidebar.css";
import { useStretch } from "@/lib/use-stretch";
import { ease } from "@lab/tokens";
import { useLab } from "../shell/prefs";
import {
  CATEGORIES, CategoryIcon, Layer, NavProvider, PageBody, PageHeader, Stack, category, hueVar, summary, useNavState, useSettings,
} from "@kit/index";

const GROUPS = [["you"], ["look", "notifications", "voice"], ["ai", "apps"], ["devices", "privacy", "plan"], ["help"]];

export default function Sidebar() {
  const { reduced } = useLab();
  const nav = useNavState({ page: "category", id: "you", title: "You" });
  const current = nav.stack[0]!.id!;
  const pick = (id: string) => {
    if (id === current && nav.depth === 0) return;
    nav.reset([{ page: "category", id, title: category(id).title }]);
  };
  return (
    <NavProvider value={nav}>
      <div className="v4">
        <Rail current={current} onPick={pick} />
        <section className="v4-content" aria-label={category(current).title}>
          <AnimatePresence initial={false} mode="popLayout">
            <motion.div
              key={current}
              className="v4-pane"
              initial={reduced ? { opacity: 0 } : { opacity: 0, y: 8, filter: "blur(4px)" }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)", transition: reduced ? { duration: 0.15 } : { duration: 0.24, ease: ease.out } }}
              exit={{ opacity: 0, transition: { duration: 0.08 } }}
            >
              <Stack
                nav={nav}
                look="push"
                render={(route, depth) => (
                  <>
                    <PageHeader
                      title={route.title}
                      onBack={depth > 0 ? nav.pop : undefined}
                      backLabel={depth > 0 ? nav.stack[depth - 1]!.title : undefined}
                    />
                    <Layer route={route} depth={depth}>
                      {depth === 0 && <p className="v4-blurb">{category(route.id!).blurb}</p>}
                      <PageBody route={route} />
                    </Layer>
                  </>
                )}
              />
            </motion.div>
          </AnimatePresence>
        </section>
      </div>
    </NavProvider>
  );
}

function Rail({ current, onPick }: { current: string; onPick: (id: string) => void }) {
  const { reduced } = useLab();
  const { values, providers, apps } = useSettings();
  const list = useRef<HTMLDivElement>(null);
  const keyed = useRef(false);
  const [box, setBox] = useState<{ start: number; end: number } | null>(null);
  useLayoutEffect(() => {
    const row = list.current?.querySelector<HTMLElement>(`[data-cat="${current}"]`);
    if (row) setBox({ start: row.offsetTop, end: row.offsetTop + row.offsetHeight });
  }, [current]);
  const stretch = useStretch(box, reduced || keyed.current);
  const ids = GROUPS.flat();
  const onKey = (event: KeyboardEvent) => {
    const step = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    keyed.current = true;
    const next = ids[(ids.indexOf(current) + step + ids.length) % ids.length]!;
    onPick(next);
    list.current?.querySelector<HTMLElement>(`[data-cat="${next}"]`)?.focus();
  };
  return (
    <nav className="v4-rail" aria-label="Settings">
      <h2 className="v4-rail-title">Settings</h2>
      <div ref={list} className="v4-rail-list" onKeyDown={onKey} onPointerDown={() => { keyed.current = false; }}>
        {box && (
          <motion.span
            aria-hidden="true"
            className="v4-highlight"
            style={{ y: stretch.start, height: stretch.size, background: `color-mix(in srgb, ${hueVar(category(current).hue)} 13%, transparent)` }}
          />
        )}
        {GROUPS.map((ids, group) => (
          <div key={group} className="v4-rail-group" data-last={group === GROUPS.length - 1 ? "" : undefined}>
            {ids.map((id) => {
              const entry = CATEGORIES.find((item) => item.id === id)!;
              const on = id === current;
              return (
                <button
                  key={id}
                  type="button"
                  data-cat={id}
                  data-nav={`category:${id}`}
                  aria-current={on ? "page" : undefined}
                  tabIndex={on ? 0 : -1}
                  className="v4-item"
                  onClick={() => onPick(id)}
                >
                  <CategoryIcon hue={entry.hue} icon={entry.icon} size={24} look={on ? "solid" : "tint"} />
                  <span className="v4-item-text">
                    <span className="v4-item-title">{entry.title}</span>
                    <span className="v4-item-value">{summary(id, values, providers, apps)}</span>
                  </span>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </nav>
  );
}
