import type { FC } from "react";
import Tiles from "./v1-tiles";
import Search from "./v2-search";
import Cards from "./v3-cards";
import Sidebar from "./v4-sidebar";
import Simple from "./v5-simple";
import Scroll from "./v6-scroll";
import Today from "./refine/today";
import Calm from "./refine/r1-calm";
import Colour from "./refine/r2-colour";
import Grouped from "./refine/r3-grouped";
import Quiet from "./refine/r4-quiet";

export type Variant = { id: string; n: number; name: string; idea: string; files: string[]; Component: FC };

const KIT = ["kit/model.ts", "kit/nav.tsx", "kit/rows.tsx", "kit/pages.tsx", "kit/kit.css"];
const REFINE = ["variants/refine/RefinedSettings.tsx", "variants/refine/refine.css", "variants/refine/stub.tsx"];
const refine = (slug: string) => [`variants/refine/${slug}.tsx`, ...REFINE];
const own = (slug: string) => [`variants/${slug}.tsx`, `variants/${slug}.css`, ...KIT];

export const VARIANTS: Variant[] = [
  { id: "tiles", n: 1, name: "Tiles", idea: "Grouped rows with solid colour tiles, like iOS. Pages push in over the last one, which drifts back.", files: own("v1-tiles"), Component: Tiles },
  { id: "search", n: 2, name: "Search", idea: "Search first. Type anything and the real switches and pickers show up right there.", files: own("v2-search"), Component: Search },
  { id: "cards", n: 3, name: "Cards", idea: "A grid of coloured cards. A card zooms open into its section and closes back into itself.", files: own("v3-cards"), Component: Cards },
  { id: "sidebar", n: 4, name: "Sidebar", idea: "A short coloured sidebar with a stretchy highlight; pages push inside the right side only.", files: own("v4-sidebar"), Component: Sidebar },
  { id: "simple", n: 5, name: "Simple", idea: "Six big friendly choices. Everything else waits under one More.", files: own("v5-simple"), Component: Simple },
  { id: "scroll", n: 6, name: "Scroll", idea: "One long page with sticky coloured headers and an index that follows your scroll.", files: own("v6-scroll"), Component: Scroll },
  { id: "today", n: 7, name: "Today", idea: "The app's Settings as it ships today, the real component, for reference.", files: ["variants/refine/today.tsx", "variants/refine/stub.tsx", "variants/refine/refine.css"], Component: Today },
  { id: "calm", n: 8, name: "Calm", idea: "Today's panel with more air: a tonal rail, a bigger pane name with one line under it, the chosen icon in its colour and a highlight that glides.", files: refine("r1-calm"), Component: Calm },
  { id: "colour", n: 9, name: "Colour", idea: "Today's panel with a soft colour tile per pane, a tinted highlight that glides, and panes that slide the way you moved on the rail.", files: refine("r2-colour"), Component: Colour },
  { id: "grouped", n: 10, name: "Grouped", idea: "Today's panel with the rail in three named groups and each group of rows on one soft surface, so what belongs together reads together.", files: refine("r3-grouped"), Component: Grouped },
  { id: "quiet", n: 11, name: "Quiet", idea: "Today's panel with no filled highlight: an accent bar glides beside the chosen pane, a larger name, and panes crossfade softly.", files: refine("r4-quiet"), Component: Quiet },
];
