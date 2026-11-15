// 5. Simple: a friendly hello and six big choices. Everything else waits under one More, which opens in place: the box
// grows first and its rows follow 80ms later. Pages push in from the right with a back button named for where you were.
import { useState, type CSSProperties } from "react";
import { AnimatePresence, motion } from "motion/react";
import "./v5-simple.css";
import { Icon } from "@/components/Icon";
import { ease, spring } from "@lab/tokens";
import { useLab } from "../shell/prefs";
import {
  CATEGORIES, CategoryIcon, Layer, Mascot, NavProvider, PageBody, PageHeader, Stack, category, hueVar, summary, useEnterStagger, useNav,
  useNavState, useSettings, type Category, type Route,
} from "@kit/index";

const BIG = ["you", "look", "ai", "apps", "devices", "notifications"];
const MORE = ["voice", "privacy", "plan", "help"];

export default function Simple() {
  const nav = useNavState({ page: "home", title: "Settings" });
  const [more, setMore] = useState(false);
  return (
    <NavProvider value={nav}>
      <div className="v5">
        <Stack
          nav={nav}
          look="push"
          render={(route, depth) => (
            <>
              {depth > 0 && <PageHeader title={route.title} onBack={nav.pop} backLabel={nav.stack[depth - 1]!.title} />}
              <Layer route={route} depth={depth}>
                <div className="v5-column">{route.page === "home" ? <Home more={more} setMore={setMore} /> : <Page route={route} />}</div>
              </Layer>
            </>
          )}
        />
      </div>
    </NavProvider>
  );
}

function Page({ route }: { route: Route }) {
  if (route.page !== "category") return <PageBody route={route} />;
  const entry = category(route.id!);
  return (
    <>
      <div className="v5-intro" style={{ "--v5-hue": hueVar(entry.hue) } as CSSProperties}>
        <CategoryIcon hue={entry.hue} icon={entry.icon} size={36} />
        <p>{entry.blurb}</p>
      </div>
      <PageBody route={route} />
    </>
  );
}

function Home({ more, setMore }: { more: boolean; setMore: (open: boolean) => void }) {
  const { profile } = useSettings();
  const { reduced } = useLab();
  const stagger = useEnterStagger();
  const big = BIG.map((id) => CATEGORIES.find((entry) => entry.id === id)!);
  const rest = MORE.map((id) => CATEGORIES.find((entry) => entry.id === id)!);
  return (
    <div className="kit-page v5-home">
      <motion.div className="v5-hello" {...stagger(0)}>
        <Mascot color="blue" size={44} />
        <div>
          <h2 className="v5-hi">Hi {profile.name || "there"}.</h2>
          <p className="v5-ask">What do you want to change?</p>
        </div>
      </motion.div>
      <div className="v5-grid" role="list">
        {big.map((entry, index) => (
          <motion.div key={entry.id} role="listitem" {...stagger(index + 1)}>
            <BigTile entry={entry} />
          </motion.div>
        ))}
      </div>
      <motion.div className="v5-more" {...stagger(BIG.length + 1)}>
        <button type="button" className="v5-more-head dusk-press-soft" aria-expanded={more} aria-controls="v5-more-list" onClick={() => setMore(!more)}>
          <span className="v5-more-dots" aria-hidden="true"><Icon name="dots-3-horizontal" size={16} /></span>
          <span className="kit-row-text">
            <span className="kit-row-title">More</span>
            <span className="kit-row-hint">Voice, privacy, your plan and help</span>
          </span>
          <motion.span
            className="kit-chevron v5-more-chevron"
            animate={{ rotate: more ? 90 : 0 }}
            transition={reduced ? { duration: 0 } : spring.settle}
          >
            <Icon name="chevron-right" size={14} />
          </motion.span>
        </button>
        <AnimatePresence initial={false}>
          {more && (
            <motion.div
              id="v5-more-list"
              key="more"
              className="v5-more-body"
              initial={reduced ? { opacity: 0 } : { height: 0 }}
              animate={reduced ? { opacity: 1, transition: { duration: 0.15 } } : { height: "auto", transition: spring.height }}
              exit={reduced ? { opacity: 0, transition: { duration: 0.1 } } : { height: 0, transition: { duration: 0.2, ease: ease.out } }}
            >
              <motion.div
                className="v5-more-rows"
                initial={reduced ? false : { opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0, transition: reduced ? { duration: 0 } : { duration: 0.22, ease: ease.out, delay: 0.08 } }}
                exit={{ opacity: 0, transition: { duration: 0.08 } }}
              >
                {rest.map((entry) => <SmallRow key={entry.id} entry={entry} />)}
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}

function BigTile({ entry }: { entry: Category }) {
  const nav = useNav();
  const { values, providers, apps } = useSettings();
  return (
    <button
      type="button"
      className="v5-tile dusk-press-soft"
      data-nav={`category:${entry.id}`}
      style={{ "--v5-hue": hueVar(entry.hue) } as CSSProperties}
      onClick={() => nav.push({ page: "category", id: entry.id, title: entry.title })}
    >
      <CategoryIcon hue={entry.hue} icon={entry.icon} size={40} />
      <span className="v5-tile-text">
        <span className="v5-tile-title">{entry.title}</span>
        <span className="v5-tile-value">{summary(entry.id, values, providers, apps)}</span>
      </span>
    </button>
  );
}

function SmallRow({ entry }: { entry: Category }) {
  const nav = useNav();
  const { values, providers, apps } = useSettings();
  return (
    <button
      type="button"
      className="kit-row kit-row-button v5-small"
      data-nav={`category:${entry.id}`}
      onClick={() => nav.push({ page: "category", id: entry.id, title: entry.title })}
    >
      <CategoryIcon hue={entry.hue} icon={entry.icon} size={28} />
      <span className="kit-row-text">
        <span className="kit-row-title">{entry.title}</span>
        <span className="kit-row-hint">{entry.blurb}</span>
      </span>
      <span className="kit-row-value">{summary(entry.id, values, providers, apps)}</span>
      <Icon name="chevron-right" size={14} className="kit-chevron" />
    </button>
  );
}
