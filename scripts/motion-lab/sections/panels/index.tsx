import type { Section } from "@lab/types";
import { panelItems } from "./panel";
import { sidebarItems } from "./sidebar";

const section: Section = {
  id: "panels",
  title: "panels and ambient",
  order: 40,
  items: [...sidebarItems, ...panelItems],
};

export default section;
