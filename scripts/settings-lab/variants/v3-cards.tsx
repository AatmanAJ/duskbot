// 3. Cards: every settings pane of the app is a coloured card. A card zooms open into the app's real pane (the card's
// surface, icon and title travel into the page; the page follows 80ms later) and closes back into the same card. Pages
// a row opens push inside the opened card. The panes, rows and sign-ins are the app's own components, run against an
// in-memory fake of its /api (variants/v3).
import { useEffect, useRef, type CSSProperties } from "react";
import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import "./v3-cards.css";
import { Icon, type IconName } from "@/components/Icon";
import { ProviderMark } from "@/components/ProviderIcons";
import { useStore } from "@/state/store";
import type { SettingsPane } from "@/lib/open-settings";
import { ease, spring } from "@lab/tokens";
import { useLab } from "../shell/prefs";
import { Layer, NavProvider, Stack, SwapText, useEnterStagger, useNav, useNavState, type Nav, type Route } from "@kit/index";
import { FakeApp } from "./v3/FakeApp";
import { PaneBody, hueVar, useCardValue, useCards, type Card } from "./v3/panes";

/** what each card is for, in a few words; the app's rail has names only */
const BLURBS: Partial<Record<SettingsPane, string>> = {
  general: "You, the look, typing and notifications",
  voice: "Talk to your bots out loud",
  texting: "Text your bots from your phone",
  computer: "Where your bots work and browse",
  permissions: "Who can use which bots",
  vault: "Logins your bots can use, never see",
  models: "Connect the AIs your bots think with",
  usage: "Limits, usage and your plan",
  updates: "Version, help and feedback",
  advanced: "Apps, skills, team and your data",
};
const WIDE = new Set<SettingsPane>(["models"]);
const SUB = "sub" as Route["page"];

export default function Cards() {
  return <FakeApp><CardsView /></FakeApp>;
}

function CardsView() {
  const nav = useNavState({ page: "home", title: "Settings" });
  const cards = useCards();
  const open = nav.depth >= 1 ? cards.find((card) => card.id === nav.stack[1]!.id) ?? null : null;
  const was = useRef<string | null>(null);
  useEffect(() => {
    // closed: the card that opened takes focus again
    if (!open && was.current) document.querySelector<HTMLElement>(`.v3 [data-nav="card:${was.current}"]`)?.focus({ preventScroll: true });
    was.current = open?.id ?? null;
  }, [open?.id]);
  return (
    <NavProvider value={nav}>
      <LayoutGroup id="v3">
        <div className="v3">
          <Home cards={cards} openId={open?.id} />
          <AnimatePresence>
            {open && <Opened key={open.id} nav={nav} card={open} />}
          </AnimatePresence>
        </div>
      </LayoutGroup>
    </NavProvider>
  );
}

function Tile({ icon, size }: { icon: IconName; size: number }) {
  return (
    <span aria-hidden="true" className="v3-tile" style={{ width: size, height: size }}>
      <Icon name={icon} size={Math.round(size * 0.54)} />
    </span>
  );
}

function Home({ cards, openId }: { cards: Card[]; openId?: string }) {
  const nav = useNav();
  const { reduced } = useLab();
  const stagger = useEnterStagger();
  return (
    <div className="kit-scroll v3-home">
      <div className="v3-home-inner">
        <h2 className="v3-big">Settings</h2>
        <div className="v3-grid">
          {cards.map((card, index) => {
            const isOpen = openId === card.id;
            return (
              <motion.div key={card.id} className="v3-cell" data-wide={WIDE.has(card.id) ? "" : undefined} {...stagger(index)}>
                <button
                  type="button"
                  className="v3-card dusk-press-soft"
                  data-nav={`card:${card.id}`}
                  style={{ "--v3-hue": hueVar(card.hue) } as CSSProperties}
                  onClick={() => nav.push({ page: "category", id: card.id, title: card.title })}
                >
                  {!isOpen && (
                    <motion.span
                      aria-hidden="true"
                      className="v3-card-surface"
                      layoutId={reduced ? undefined : `v3-card-${card.id}`}
                      transition={spring.layout}
                      style={{ borderRadius: 18 }}
                    />
                  )}
                  <span className="v3-card-top">
                    {isOpen
                      ? <span className="v3-icon-hole" />
                      : <motion.span layoutId={reduced ? undefined : `v3-icon-${card.id}`} transition={spring.layout} className="v3-icon"><Tile icon={card.icon} size={34} /></motion.span>}
                    <CardValue id={card.id} />
                  </span>
                  {isOpen
                    ? <span className="v3-card-title" style={{ visibility: "hidden" }}>{card.title}</span>
                    : <motion.span layoutId={reduced ? undefined : `v3-title-${card.id}`} transition={spring.layout} className="v3-card-title">{card.title}</motion.span>}
                  <span className="v3-card-blurb">{BLURBS[card.id]}</span>
                  {card.id === "models" && <AiPreview />}
                </button>
              </motion.div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function CardValue({ id }: { id: SettingsPane }) {
  const value = useCardValue(id);
  return <span className="v3-card-value">{value}</span>;
}

/** the AI card shows which AIs are signed in, with the app's own marks */
function AiPreview() {
  const { state } = useStore();
  return (
    <span className="v3-preview" aria-hidden="true">
      {state.instances.map((instance) => (
        <span key={instance.instanceId} className="v3-chip" data-on={instance.snapshot.authenticated ? "" : undefined}>
          <ProviderMark driverKind={instance.driverKind} size={16} />
        </span>
      ))}
    </span>
  );
}

/** the opened card: its surface fills the box, its icon and title land in the bar, and the pane follows in */
function Opened({ nav, card }: { nav: Nav; card: Card }) {
  const { reduced } = useLab();
  const deep = nav.depth >= 2;
  const follow = {
    initial: reduced ? { opacity: 0 } : { opacity: 0, y: 8, filter: "blur(4px)" },
    animate: { opacity: 1, y: 0, filter: "blur(0px)", transition: { duration: reduced ? 0.15 : 0.26, ease: ease.out, delay: reduced ? 0 : 0.08 } },
    exit: { opacity: 0, transition: { duration: 0.08 } },
  };
  const backTo = deep ? nav.stack[nav.depth - 1]!.title : "Settings";
  return (
    <motion.div className="v3-open" data-settings-look="simple" style={{ "--v3-hue": hueVar(card.hue) } as CSSProperties}>
      <motion.div
        aria-hidden="true"
        className="v3-surface"
        layoutId={reduced ? undefined : `v3-card-${card.id}`}
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
        <motion.span layoutId={reduced ? undefined : `v3-icon-${card.id}`} transition={spring.layout} className="v3-icon" {...(reduced ? follow : {})}>
          <Tile icon={card.icon} size={28} />
        </motion.span>
        <motion.span layoutId={reduced ? undefined : `v3-title-${card.id}`} transition={spring.layout} className="v3-bar-title" {...(reduced ? follow : {})}>
          {card.title}
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
          render={(_route, depth) => (
            <Layer route={nav.stack[depth]!} depth={depth}>
              <PaneBody
                pane={card.id}
                pages={nav.stack.slice(2, depth + 1).map((route) => ({ id: route.id!, title: route.title }))}
                open={(page) => nav.push({ page: SUB, id: page.id, title: page.title })}
                back={nav.pop}
              />
            </Layer>
          )}
        />
      </motion.div>
    </motion.div>
  );
}
