import { useCallback, useEffect, useMemo, useState } from "react";
import { MotionConfig } from "motion/react";
import { Icon } from "@/components/Icon";
import type { Item, Section } from "@lab/types";
import { loadSections, type Loaded } from "./load";
import { itemKey, usePicks, useStored } from "./prefs";
import { setLabSpeed } from "./clock";
import { ItemView } from "./ItemView";
import { PicksPage, exportPicks } from "./PicksPage";

const SPEEDS = [1, 0.5, 0.25] as const;
type Theme = "light" | "dark";
type Route = { kind: "item"; section: string; item: string } | { kind: "picks" };

const parseRoute = (): Route | null => {
  const parts = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
  if (parts[0] === "picks") return { kind: "picks" };
  if (parts.length >= 2) return { kind: "item", section: parts[0], item: parts[1] };
  if (parts.length === 1) return { kind: "item", section: parts[0], item: "" };
  return null;
};
const hashFor = (route: Route) => (route.kind === "picks" ? "#/picks" : `#/${encodeURIComponent(route.section)}/${encodeURIComponent(route.item)}`);

const isEditable = (el: EventTarget | null) =>
  el instanceof HTMLElement && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));

export function App() {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [route, setRoute] = useState<Route | null>(parseRoute);
  const [theme, setTheme] = useStored<Theme>("motion-lab-theme", matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  const [speed, setSpeed] = useStored<number>("motion-lab-speed", 1);
  const [reduced, setReduced] = useStored<boolean>("motion-lab-reduced", matchMedia("(prefers-reduced-motion: reduce)").matches);
  const [loop, setLoop] = useStored<boolean>("motion-lab-loop", false);
  const [replays, setReplays] = useState<Record<string, number>>({});
  const [picks, updatePick] = usePicks();

  useEffect(() => void loadSections().then(setLoaded), []);
  useEffect(() => {
    const onHash = () => setRoute(parseRoute());
    addEventListener("hashchange", onHash);
    return () => removeEventListener("hashchange", onHash);
  }, []);
  useEffect(() => {
    document.documentElement.dataset.skin = theme === "dark" ? "grok-dark" : "grok";
    document.documentElement.style.colorScheme = theme;
  }, [theme]);
  useEffect(() => setLabSpeed(speed), [speed]);
  useEffect(() => {
    document.documentElement.dataset.reducedMotion = String(reduced);
  }, [reduced]);

  const sections = loaded?.sections ?? [];
  const flat = useMemo(() => sections.flatMap((s) => s.items.map((item) => ({ section: s, item }))), [sections]);

  // the route's item, or the first one
  const current = useMemo(() => {
    if (route?.kind === "picks") return null;
    const inSection = route ? flat.filter((f) => f.section.id === route.section) : [];
    return inSection.find((f) => f.item.id === route?.item) ?? inSection[0] ?? flat[0] ?? null;
  }, [route, flat]);

  const go = useCallback((next: Route) => {
    history.replaceState(null, "", hashFor(next));
    setRoute(next);
  }, []);

  const replay = useCallback((key: string) => setReplays((r) => ({ ...r, [key]: (r[key] ?? 0) + 1 })), []);
  const replayAll = useCallback(
    () => setReplays((r) => Object.fromEntries(flat.map(({ section, item }) => [itemKey(section.id, item.id), (r[itemKey(section.id, item.id)] ?? 0) + 1]))),
    [flat],
  );

  // keyboard: arrows move between items, R replays the current one (shift+R replays all)
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || isEditable(event.target)) return;
      if (event.target instanceof Element && event.target.closest(".lab-stage")) return;
      if (event.key === "r" || event.key === "R") {
        event.preventDefault();
        if (event.shiftKey) replayAll();
        else if (current) replay(itemKey(current.section.id, current.item.id));
        return;
      }
      const step = event.key === "ArrowDown" || event.key === "ArrowRight" ? 1 : event.key === "ArrowUp" || event.key === "ArrowLeft" ? -1 : 0;
      if (!step || !current || !flat.length) return;
      event.preventDefault();
      const at = flat.findIndex((f) => f.section.id === current.section.id && f.item.id === current.item.id);
      const next = flat[Math.min(flat.length - 1, Math.max(0, at + step))];
      go({ kind: "item", section: next.section.id, item: next.item.id });
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [current, flat, go, replay, replayAll]);

  const pickedCount = flat.filter(({ section, item }) => picks[itemKey(section.id, item.id)]?.pick).length;

  return (
    <MotionConfig reducedMotion={reduced ? "always" : "never"}>
      <div className="lab-root">
        <nav className="lab-nav" aria-label="sections and items">
          <div className="lab-brand">
            <span>motion lab</span>
            <span className="lab-quiet">dusk bot</span>
          </div>
          <div className="lab-nav-scroll">
            {sections.map((section) => (
              <SectionNav key={section.id} section={section} currentItem={current?.item} currentSection={current?.section} picks={picks} onPick={(item) => go({ kind: "item", section: section.id, item: item.id })} />
            ))}
            {loaded && !sections.length && <p className="lab-quiet lab-pad">no sections yet. add one in scripts/motion-lab/sections/</p>}
            {loaded?.failed.map((f) => (
              <p key={f.path} className="lab-failed lab-pad" role="status">
                <Icon name="exclamation-circle" size={14} /> {f.path} failed to load
              </p>
            ))}
          </div>
          <a
            href="#/picks"
            onClick={(event) => (event.preventDefault(), go({ kind: "picks" }))}
            className="lab-nav-item lab-nav-picks"
            aria-current={route?.kind === "picks" ? "page" : undefined}
          >
            <Icon name="list-checks" size={15} />
            <span>picks</span>
            <span className="lab-count">
              {pickedCount}/{flat.length}
            </span>
          </a>
        </nav>

        <main className="lab-main">
          <header className="lab-bar">
            <div className="lab-bar-group">
              <button type="button" className="lab-btn" onClick={replayAll} title="replay all (shift R)">
                <Icon name="refresh" size={15} />
                replay all
              </button>
              <button type="button" className="lab-btn" aria-pressed={loop} onClick={() => setLoop((v) => !v)}>
                <Icon name={loop ? "pause" : "play"} size={15} />
                auto-loop
              </button>
            </div>
            <div className="lab-bar-group">
              <div className="lab-seg" role="radiogroup" aria-label="speed">
                {SPEEDS.map((s) => (
                  <button key={s} type="button" role="radio" aria-checked={speed === s} className="lab-seg-btn" onClick={() => setSpeed(s)}>
                    {s}x
                  </button>
                ))}
              </div>
              <button type="button" className="lab-btn" aria-pressed={reduced} onClick={() => setReduced((v) => !v)}>
                reduced motion
              </button>
              <button
                type="button"
                className="lab-btn lab-btn-icon"
                aria-label={theme === "dark" ? "switch to light" : "switch to dark"}
                onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
              >
                <Icon name={theme === "dark" ? "sun" : "moon"} size={15} />
              </button>
            </div>
          </header>

          {!loaded && <p className="lab-quiet lab-pad">loading sections</p>}
          {route?.kind === "picks" ? (
            <PicksPage flat={flat} picks={picks} onOpen={(s, i) => go({ kind: "item", section: s, item: i })} />
          ) : current ? (
            <SectionPage
              key={current.section.id}
              section={current.section}
              current={current.item}
              replays={replays}
              speed={speed}
              reduced={reduced}
              loop={loop}
              picks={picks}
              onPick={updatePick}
              onReplay={replay}
              onFocusItem={(item) => go({ kind: "item", section: current.section.id, item: item.id })}
            />
          ) : null}
          {route?.kind !== "picks" && flat.length > 0 && (
            <footer className="lab-foot lab-quiet">
              <span>
                <kbd>↑</kbd> <kbd>↓</kbd> move between items
              </span>
              <span>
                <kbd>R</kbd> replay, <kbd>shift R</kbd> replay all
              </span>
              <button type="button" className="lab-link" onClick={() => exportPicks(flat, picks, "copy")}>
                copy picks
              </button>
            </footer>
          )}
        </main>
      </div>
    </MotionConfig>
  );
}

function SectionNav({
  section, currentSection, currentItem, picks, onPick,
}: { section: Section; currentSection?: Section; currentItem?: Item; picks: ReturnType<typeof usePicks>[0]; onPick: (item: Item) => void }) {
  return (
    <div className="lab-nav-section">
      <p className="lab-nav-title">{section.title}</p>
      {section.items.map((item) => {
        const active = currentSection?.id === section.id && currentItem?.id === item.id;
        const pick = picks[itemKey(section.id, item.id)]?.pick;
        return (
          <a
            key={item.id}
            href={hashFor({ kind: "item", section: section.id, item: item.id })}
            onClick={(event) => (event.preventDefault(), onPick(item))}
            className="lab-nav-item"
            aria-current={active ? "true" : undefined}
          >
            <span className="lab-truncate">{item.title}</span>
            {pick && <span className="lab-pick-tag">{pick === "original" ? "orig" : pick.toUpperCase()}</span>}
          </a>
        );
      })}
    </div>
  );
}

function SectionPage({
  section, current, replays, speed, reduced, loop, picks, onPick, onReplay, onFocusItem,
}: {
  section: Section; current: Item; replays: Record<string, number>; speed: number; reduced: boolean; loop: boolean;
  picks: ReturnType<typeof usePicks>[0]; onPick: ReturnType<typeof usePicks>[1]; onReplay: (key: string) => void; onFocusItem: (item: Item) => void;
}) {
  // the current item scrolls into view when the route moves to it
  useEffect(() => {
    document.getElementById(`item-${current.id}`)?.scrollIntoView({ block: "nearest", behavior: "auto" });
  }, [current.id]);

  // auto-loop replays every item on the page, each on its own period at the lab's speed
  useEffect(() => {
    if (!loop) return;
    const timers = section.items.map((item) =>
      setInterval(() => onReplay(itemKey(section.id, item.id)), (item.loopMs ?? 3200) / speed),
    );
    return () => timers.forEach(clearInterval);
  }, [loop, speed, section, onReplay]);

  return (
    <div className="lab-page">
      <h1 className="lab-h1">{section.title}</h1>
      {section.items.map((item) => {
        const key = itemKey(section.id, item.id);
        return (
          <ItemView
            key={item.id}
            item={item}
            active={item.id === current.id}
            replayKey={replays[key] ?? 0}
            speed={speed}
            reduced={reduced}
            pick={picks[key] ?? {}}
            onPick={(patch) => onPick(key, patch)}
            onReplay={() => onReplay(key)}
            onFocus={() => item.id !== current.id && onFocusItem(item)}
          />
        );
      })}
    </div>
  );
}
