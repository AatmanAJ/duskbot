import type { Section } from "@lab/types";
import { dashChips } from "./dash-chips";
import { dashPage } from "./dash-page";
import { dashPlans } from "./dash-plans";
import { dashSheet } from "./dash-sheet";
import { dashStats } from "./dash-stats";

const section: Section = {
  id: "web",
  title: "dashboard, admin and site",
  order: 50,
  items: [dashPage, dashStats, dashSheet, dashChips, dashPlans],
};

export default section;
