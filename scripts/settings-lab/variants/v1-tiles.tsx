// 1. Tiles: one calm column of grouped rows, each with a solid colour tile, like iOS Settings. Every page pushes in from
// the right over the one before, which drifts back 30% and dims; back pops to the same scroll spot and row.
import { motion } from "motion/react";
import "./v1-tiles.css";
import { Icon } from "@/components/Icon";
import { spring } from "@lab/tokens";
import {
  CATEGORIES, CategoryIcon, Layer, NavProvider, PageBody, PageHeader, Stack, category, summary, useEnterStagger, useNav, useNavState,
  useSettings, type Route,
} from "@kit/index";

const GROUPS = [["look", "notifications", "voice"], ["ai", "apps"], ["devices", "privacy", "plan"], ["help"]];

export default function Tiles() {
  const nav = useNavState({ page: "home", title: "Settings" });
  return (
    <NavProvider value={nav}>
      <div className="v1">
        <Stack
          nav={nav}
          look="push"
          render={(route, depth) => (
            <>
              {depth > 0 && <PageHeader title={route.title} onBack={nav.pop} backLabel={nav.stack[depth - 1]!.title} />}
              <Layer route={route} depth={depth}>
                <div className="v1-column">{route.page === "home" ? <Home /> : <Page route={route} />}</div>
              </Layer>
            </>
          )}
        />
      </div>
    </NavProvider>
  );
}

function Page({ route }: { route: Route }) {
  const hue = route.page === "category" ? category(route.id!).hue : undefined;
  return (
    <>
      {hue && route.page === "category" && (
        <div className="v1-hero">
          <CategoryIcon hue={hue} icon={category(route.id!).icon} size={48} look="solid" />
          <p>{category(route.id!).blurb}</p>
        </div>
      )}
      <PageBody route={route} />
    </>
  );
}

function Home() {
  const nav = useNav();
  const { values, providers, apps, profile } = useSettings();
  const stagger = useEnterStagger();
  let index = 0;
  return (
    <div className="kit-page">
      <h2 className="v1-big">Settings</h2>
      <motion.button
        {...stagger(index++)}
        type="button"
        className="v1-me dusk-press-soft"
        data-nav="category:you"
        onClick={() => nav.push({ page: "category", id: "you", title: "You" })}
      >
        <span className="kit-avatar">{profile.name.slice(0, 1)}</span>
        <span className="kit-row-text">
          <span className="v1-me-name">{profile.name}</span>
          <span className="kit-row-hint">{profile.email} · account and what bots know about you</span>
        </span>
        <Icon name="chevron-right" size={14} className="kit-chevron" />
      </motion.button>
      {GROUPS.map((ids) => (
        <motion.div key={ids.join()} className="kit-group" {...stagger(index++)}>
          {ids.map((id) => {
            const entry = CATEGORIES.find((item) => item.id === id)!;
            return (
              <button
                key={id}
                type="button"
                className="kit-row kit-row-button v1-row"
                data-nav={`category:${id}`}
                onClick={() => nav.push({ page: "category", id, title: entry.title })}
              >
                <CategoryIcon hue={entry.hue} icon={entry.icon} size={30} look="solid" />
                <span className="kit-row-text">
                  <span className="kit-row-title">{entry.title}</span>
                </span>
                <motion.span layout="position" transition={spring.layout} className="kit-row-value">{summary(id, values, providers, apps)}</motion.span>
                <Icon name="chevron-right" size={14} className="kit-chevron" />
              </button>
            );
          })}
        </motion.div>
      ))}
    </div>
  );
}
