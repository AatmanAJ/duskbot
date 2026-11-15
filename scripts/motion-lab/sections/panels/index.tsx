import type { Section } from "@lab/types";
import { browserItems } from "./browser";
import { overlayItems } from "./overlays";
import { ambientItems } from "./ambient";
import { panelItems } from "./panel";
import { sidebarItems } from "./sidebar";

const section: Section = {
  id: "panels",
  title: "panels and ambient",
  order: 40,
  items: [...sidebarItems, ...panelItems, ...browserItems, ...overlayItems, ...ambientItems],
};

export default section;
