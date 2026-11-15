// 2. Search: the field comes first. Typing finds any setting across every category and shows its real switch or picker
// right in the results; arrows move the highlight at once and Enter acts. Pages rise in under a back button.
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { AnimatePresence, motion } from "motion/react";
import "./v2-search.css";
import { Icon } from "@/components/Icon";
import { spring } from "@lab/tokens";
import { useLab } from "../shell/prefs";
import {
  CATEGORIES, CategoryIcon, Layer, NavProvider, PageBody, PageHeader, RowView, Stack, searchIndex, summary, useEnterStagger, useNav,
  useNavState, useSettings, type Category, type Indexed, type Row,
} from "@kit/index";

const SUGGESTED: Array<[string, string]> = [["look", "theme"], ["look", "style"], ["notifications", "notify"], ["voice", "sendKey"]];

const rowId = (row: Row) => (row.kind === "page" ? `page:${row.page}` : row.kind === "link" ? `link:${row.title}` : row.kind === "custom" ? row.id : row.id);

function findRow(categoryId: string, id: string): Row | undefined {
  const entry = CATEGORIES.find((item) => item.id === categoryId);
  return entry?.sections.flatMap((section) => section.rows).find((row) => rowId(row) === id);
}

export default function Search() {
  const nav = useNavState({ page: "home", title: "Settings" });
  const [query, setQuery] = useState("");
  return (
    <NavProvider value={nav}>
      <div className="v2">
        <Stack
          nav={nav}
          look="rise"
          render={(route, depth) => (route.page === "home"
            ? <Home query={query} setQuery={setQuery} depth={depth} />
            : (
              <>
                <PageHeader title={route.title} onBack={nav.pop} backLabel={nav.stack[depth - 1]!.page === "home" ? "Settings" : nav.stack[depth - 1]!.title} />
                <Layer route={route} depth={depth}><div className="v2-column"><PageBody route={route} /></div></Layer>
              </>
            ))}
        />
      </div>
    </NavProvider>
  );
}

function Home({ query, setQuery, depth }: { query: string; setQuery: (value: string) => void; depth: number }) {
  const nav = useNav();
  const { values } = useSettings();
  const [active, setActive] = useState(0);
  const [focused, setFocused] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  const q = query.trim().toLowerCase();

  const results = useMemo(() => {
    if (!q) return [];
    return searchIndex().filter((entry) => {
      if ("when" in entry.row && entry.row.when && !entry.row.when(values)) return false;
      return `${entry.title} ${entry.hint ?? ""} ${entry.category.title}`.toLowerCase().includes(q);
    });
  }, [q, values]);
  const groups = useMemo(() => {
    const byCategory = new Map<Category, Indexed[]>();
    for (const entry of results) byCategory.set(entry.category, [...(byCategory.get(entry.category) ?? []), entry]);
    return [...byCategory.entries()];
  }, [results]);
  const categoryHits = q ? CATEGORIES.filter((entry) => `${entry.title} ${entry.blurb}`.toLowerCase().includes(q)) : [];

  // the highlight follows the list as it is in the page: suggested, categories, or results
  const items = () => Array.from(list.current?.querySelectorAll<HTMLElement>("[data-v2-item]") ?? []);
  useEffect(() => setActive(0), [q]);
  useEffect(() => { if (focused) items()[active]?.scrollIntoView({ block: "nearest" }); }, [active, focused]);

  const onKey = (event: KeyboardEvent<HTMLInputElement>) => {
    const count = items().length;
    if (event.key === "ArrowDown") { event.preventDefault(); setActive((at) => Math.min(count - 1, at + 1)); }
    else if (event.key === "ArrowUp") { event.preventDefault(); setActive((at) => Math.max(0, at - 1)); }
    else if (event.key === "Escape" && query) { event.preventDefault(); event.stopPropagation(); setQuery(""); }
    else if (event.key === "Enter") {
      const item = items()[active];
      const control = item?.querySelector<HTMLElement>('[role="switch"], .kit-row-button, .kit-picker-trigger, button[data-v2-go]');
      // a pick-one row takes focus on its chosen option, so the arrows choose; Enter never changes it on its own
      const radio = item?.querySelector<HTMLElement>('[role="radio"][aria-checked="true"]');
      if (control) { event.preventDefault(); control.click(); }
      else if (radio) { event.preventDefault(); radio.focus(); }
    }
  };

  const pick = (index: number) => () => setActive(index);
  const on = (index: number) => (focused && index === active ? "" : undefined);
  let n = 0;

  return (
    <>
      <div className="v2-top">
        <label className="v2-field">
          <Icon name="search" size={18} />
          <input
            autoFocus={depth === 0 && nav.dir !== -1}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKey}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder="Search settings"
            aria-label="Search settings"
            aria-controls="v2-results"
          />
          {query && <button type="button" className="v2-clear" aria-label="Clear search" onClick={() => setQuery("")}><Icon name="close" size={12} /></button>}
        </label>
      </div>
      <Layer route={nav.top} depth={depth}>
        <div ref={list} id="v2-results" className="v2-column v2-list">
          {!q && <Idle onHover={pick} on={on} />}
          {q && (
            <>
              <p className="v2-count" aria-live="polite">{results.length + categoryHits.length === 0 ? "" : `${results.length} ${results.length === 1 ? "setting" : "settings"}${categoryHits.length ? `, ${categoryHits.length} ${categoryHits.length === 1 ? "section" : "sections"}` : ""}`}</p>
              <AnimatePresence mode="popLayout" initial={false}>
                {categoryHits.length > 0 && (
                  <motion.section key="sections" layout className="kit-section" {...fade} transition={spring.layout}>
                    <h3 className="kit-section-title">Sections</h3>
                    <div className="kit-group">
                      {categoryHits.map((entry) => {
                        const index = n++;
                        return <CategoryRow key={entry.id} entry={entry} onHover={pick(index)} active={on(index)} />;
                      })}
                    </div>
                  </motion.section>
                )}
                {groups.map(([entry, rows]) => (
                  <motion.section key={entry.id} layout className="kit-section" {...fade} transition={spring.layout}>
                    <h3 className="kit-section-title v2-group-title">
                      <CategoryIcon hue={entry.hue} icon={entry.icon} size={18} />
                      {entry.title}
                    </h3>
                    <motion.div layout className="kit-group" transition={spring.layout}>
                      <AnimatePresence mode="popLayout" initial={false}>
                        {rows.map((hit) => {
                          const index = n++;
                          return (
                            <motion.div
                              key={`${entry.id}:${rowId(hit.row)}`}
                              layout="position"
                              className="v2-item"
                              data-v2-item=""
                              data-active={on(index)}
                              onPointerMove={pick(index)}
                              transition={spring.layout}
                              {...fade}
                            >
                              <RowView row={hit.row} />
                            </motion.div>
                          );
                        })}
                      </AnimatePresence>
                    </motion.div>
                  </motion.section>
                ))}
              </AnimatePresence>
              {results.length + categoryHits.length === 0 && (
                <div className="kit-empty v2-empty">
                  <Icon name="search" size={18} />
                  <strong>No setting called “{query.trim()}”</strong>
                  <span>Try a plain word like “dark”, “sound”, “phone” or “Gmail”.</span>
                  <button type="button" className="kit-pill dusk-press" onClick={() => setQuery("")}>Clear search</button>
                </div>
              )}
            </>
          )}
        </div>
      </Layer>
    </>
  );
}

const fade = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: 0.18 } },
  exit: { opacity: 0, transition: { duration: 0.08 } },
};

/** nothing typed: the few controls people change most, then every section */
function Idle({ onHover, on }: { onHover: (index: number) => () => void; on: (index: number) => string | undefined }) {
  const { reduced } = useLab();
  const stagger = useEnterStagger();
  let n = 0;
  return (
    <>
      <section className="kit-section">
        <h3 className="kit-section-title">Suggested</h3>
        <div className="kit-group">
          {SUGGESTED.map(([categoryId, id]) => {
            const row = findRow(categoryId, id);
            if (!row) return null;
            const index = n++;
            return <div key={id} className="v2-item" data-v2-item="" data-active={on(index)} onPointerMove={onHover(index)}><RowView row={row} /></div>;
          })}
        </div>
      </section>
      <section className="kit-section">
        <h3 className="kit-section-title">Everything</h3>
        <div className="kit-group">
          {CATEGORIES.map((entry, at) => {
            const index = n++;
            return (
              <motion.div key={entry.id} {...(reduced ? {} : stagger(at))}>
                <CategoryRow entry={entry} onHover={onHover(index)} active={on(index)} />
              </motion.div>
            );
          })}
        </div>
      </section>
    </>
  );
}

function CategoryRow({ entry, onHover, active }: { entry: Category; onHover: () => void; active?: string }) {
  const nav = useNav();
  const { values, providers, apps } = useSettings();
  return (
    <div className="v2-item" data-v2-item="" data-active={active} onPointerMove={onHover}>
      <button
        type="button"
        data-v2-go=""
        className="kit-row kit-row-button v2-cat"
        data-nav={`category:${entry.id}`}
        onClick={() => nav.push({ page: "category", id: entry.id, title: entry.title })}
      >
        <CategoryIcon hue={entry.hue} icon={entry.icon} size={26} />
        <span className="kit-row-text">
          <span className="kit-row-title">{entry.title}</span>
          <span className="kit-row-hint">{entry.blurb}</span>
        </span>
        <span className="kit-row-value">{summary(entry.id, values, providers, apps)}</span>
        <Icon name="chevron-right" size={14} className="kit-chevron" />
      </button>
    </div>
  );
}
