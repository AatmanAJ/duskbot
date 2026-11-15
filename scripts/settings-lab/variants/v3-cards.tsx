// 3. Cards: every category is a coloured card. A card zooms open into its section (the card's surface, icon and title
// travel into the page; the page's words follow 80ms later) and closes back into the same card. Deeper pages push inside
// the opened card.
import { useEffect, useRef, type CSSProperties } from "react";
import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import "./v3-cards.css";
import { Icon } from "@/components/Icon";
import { ease, spring } from "@lab/tokens";
import { useLab } from "../shell/prefs";
import {
  APPS, AppLogo, CategoryBody, CategoryIcon, Layer, NavProvider, PROVIDERS, PageBody, ProviderLogo, Stack, SwapText, category, hueVar, summary,
  useEnterStagger, useNav, useNavState, useSettings, type Nav,
} from "@kit/index";

const ORDER = ["ai", "apps", "you", "look", "voice", "notifications", "devices", "privacy", "plan", "help"];
const WIDE = new Set(["ai", "apps"]);

export default function Cards() {
  const nav = useNavState({ page: "home", title: "Settings" });
  const open = nav.depth >= 1 ? nav.stack[1]! : null;
  const was = useRef<string | null>(null);
  useEffect(() => {
    // closed: the card that opened takes focus again
    if (!open && was.current) document.querySelector<HTMLElement>(`.v3 [data-nav="category:${was.current}"]`)?.focus({ preventScroll: true });
    was.current = open?.id ?? null;
  }, [open?.id]);
  return (
    <NavProvider value={nav}>
      <LayoutGroup id="v3">
        <div className="v3">
          <Home openId={open?.id} />
          <AnimatePresence>
            {open && <Opened key={open.id} nav={nav} id={open.id!} />}
          </AnimatePresence>
        </div>
      </LayoutGroup>
    </NavProvider>
  );
}

function Home({ openId }: { openId?: string }) {
  const nav = useNav();
  const { values, providers, apps } = useSettings();
  const { reduced } = useLab();
  const stagger = useEnterStagger();
  return (
    <div className="kit-scroll v3-home">
      <div className="v3-home-inner">
        <h2 className="v3-big">Settings</h2>
        <div className="v3-grid">
          {ORDER.map((id, index) => {
            const entry = category(id);
            const isOpen = openId === id;
            return (
              <motion.div key={id} className="v3-cell" data-wide={WIDE.has(id) ? "" : undefined} {...stagger(index)}>
                <button
                  type="button"
                  className="v3-card dusk-press-soft"
                  data-nav={`category:${id}`}
                  style={{ "--v3-hue": hueVar(entry.hue) } as CSSProperties}
                  onClick={() => nav.push({ page: "category", id, title: entry.title })}
                >
                  {!isOpen && (
                    <motion.span
                      aria-hidden="true"
                      className="v3-card-surface"
                      layoutId={reduced ? undefined : `v3-card-${id}`}
                      transition={spring.layout}
                      style={{ borderRadius: 18 }}
                    />
                  )}
                  <span className="v3-card-top">
                    {isOpen
                      ? <span className="v3-icon-hole" />
                      : <motion.span layoutId={reduced ? undefined : `v3-icon-${id}`} transition={spring.layout} className="v3-icon"><CategoryIcon hue={entry.hue} icon={entry.icon} size={34} look="solid" /></motion.span>}
                    <span className="v3-card-value">{summary(id, values, providers, apps)}</span>
                  </span>
                  {isOpen
                    ? <span className="v3-card-title" style={{ visibility: "hidden" }}>{entry.title}</span>
                    : <motion.span layoutId={reduced ? undefined : `v3-title-${id}`} transition={spring.layout} className="v3-card-title">{entry.title}</motion.span>}
                  <span className="v3-card-blurb">{entry.blurb}</span>
                  {WIDE.has(id) && <Preview id={id} />}
                </button>
              </motion.div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** the two big cards show their live state: which AIs and which apps are connected */
function Preview({ id }: { id: string }) {
  const { providers, apps } = useSettings();
  if (id === "ai") {
    return (
      <span className="v3-preview" aria-hidden="true">
        {PROVIDERS.slice(0, 6).map((provider) => (
          <span key={provider.id} className="v3-chip" data-on={providers[provider.id] === "on" ? "" : undefined}>
            <ProviderLogo provider={provider} size={16} />
          </span>
        ))}
      </span>
    );
  }
  const on = APPS.filter((app) => apps[app.id] === "on");
  return (
    <span className="v3-preview" aria-hidden="true">
      {on.map((app) => <span key={app.id} className="v3-chip" data-on=""><AppLogo app={app} size={18} /></span>)}
      <span className="v3-chip v3-chip-more"><Icon name="plus" size={13} /></span>
    </span>
  );
}

/** the opened card: its surface fills the box, its icon and title land in the bar, and the section follows in */
function Opened({ nav, id }: { nav: Nav; id: string }) {
  const entry = category(id);
  const { reduced } = useLab();
  const deep = nav.depth >= 2;
  const follow = {
    initial: reduced ? { opacity: 0 } : { opacity: 0, y: 8, filter: "blur(4px)" },
    animate: { opacity: 1, y: 0, filter: "blur(0px)", transition: { duration: reduced ? 0.15 : 0.26, ease: ease.out, delay: reduced ? 0 : 0.08 } },
    exit: { opacity: 0, transition: { duration: 0.08 } },
  };
  const backTo = deep ? nav.stack[nav.depth - 1]!.title : "Settings";
  return (
    <motion.div className="v3-open" style={{ "--v3-hue": hueVar(entry.hue) } as CSSProperties}>
      <motion.div
        aria-hidden="true"
        className="v3-surface"
        layoutId={reduced ? undefined : `v3-card-${id}`}
        transition={spring.layout}
        style={{ borderRadius: 14 }}
        initial={reduced ? { opacity: 0 } : undefined}
        animate={reduced ? { opacity: 1, transition: { duration: 0.15 } } : undefined}
        exit={reduced ? { opacity: 0, transition: { duration: 0.1 } } : undefined}
      />
      <header className="v3-bar">
        <motion.button type="button" className="kit-back" onClick={nav.pop} aria-label={`Back to ${backTo}`} {...follow}>
          <Icon name="chevron-left" size={16} />
        </motion.button>
        <motion.span layoutId={reduced ? undefined : `v3-icon-${id}`} transition={spring.layout} className="v3-icon" {...(reduced ? follow : {})}>
          <CategoryIcon hue={entry.hue} icon={entry.icon} size={28} look="solid" />
        </motion.span>
        <motion.span layoutId={reduced ? undefined : `v3-title-${id}`} transition={spring.layout} className="v3-bar-title" {...(reduced ? follow : {})}>
          {entry.title}
        </motion.span>
        <AnimatePresence initial={false}>
          {deep && (
            <motion.span
              key="crumb"
              className="v3-crumb"
              initial={reduced ? { opacity: 0 } : { opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0, transition: { duration: 0.2, ease: ease.out } }}
              exit={{ opacity: 0, transition: { duration: 0.1 } }}
            >
              <Icon name="chevron-right" size={13} className="kit-chevron" />
              <SwapText text={nav.top.title} className="v3-bar-title" />
            </motion.span>
          )}
        </AnimatePresence>
      </header>
      <motion.div className="v3-body" {...follow}>
        <Stack
          nav={nav}
          look="push"
          render={(route, depth) => (
            <Layer route={route} depth={depth}>
              {depth === 1 ? <CategoryBody id={id} /> : <PageBody route={route} />}
            </Layer>
          )}
        />
      </motion.div>
    </motion.div>
  );
}
