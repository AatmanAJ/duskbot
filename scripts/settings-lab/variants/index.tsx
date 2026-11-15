import type { FC } from "react";
import Tiles from "./v1-tiles";
import Search from "./v2-search";
import Cards from "./v3-cards";
import Sidebar from "./v4-sidebar";
import Simple from "./v5-simple";
import Scroll from "./v6-scroll";

export type Variant = { id: string; n: number; name: string; idea: string; files: string[]; Component: FC };

const KIT = ["kit/model.ts", "kit/nav.tsx", "kit/rows.tsx", "kit/pages.tsx", "kit/kit.css"];
const own = (slug: string) => [`variants/${slug}.tsx`, `variants/${slug}.css`, ...KIT];

export const VARIANTS: Variant[] = [
  { id: "tiles", n: 1, name: "Tiles", idea: "Grouped rows with solid colour tiles, like iOS. Pages push in over the last one, which drifts back.", files: own("v1-tiles"), Component: Tiles },
  { id: "search", n: 2, name: "Search", idea: "Search first. Type anything and the real switches and pickers show up right there.", files: own("v2-search"), Component: Search },
  { id: "cards", n: 3, name: "Cards", idea: "A grid of coloured cards. A card zooms open into its section and closes back into itself.", files: own("v3-cards"), Component: Cards },
  { id: "sidebar", n: 4, name: "Sidebar", idea: "A short coloured sidebar with a stretchy highlight; pages push inside the right side only.", files: own("v4-sidebar"), Component: Sidebar },
  { id: "simple", n: 5, name: "Simple", idea: "Six big friendly choices. Everything else waits under one More.", files: own("v5-simple"), Component: Simple },
  { id: "scroll", n: 6, name: "Scroll", idea: "One long page with sticky coloured headers and an index that follows your scroll.", files: own("v6-scroll"), Component: Scroll },
];
