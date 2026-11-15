import type { Section } from "@lab/types";
import { dashChips } from "./dash-chips";
import { dashPage } from "./dash-page";
import { dashPlans } from "./dash-plans";
import { dashSheet } from "./dash-sheet";
import { dashStats } from "./dash-stats";
import { siteHero } from "./site-hero";
import { siteApproval, sitePages, sitePricing, siteSprites } from "./site-more";
import { siteCards, siteDay, siteHow, siteLid } from "./site-sections";

const section: Section = {
  id: "web",
  title: "dashboard, admin and site",
  order: 50,
  items: [dashPage, dashStats, dashSheet, dashChips, dashPlans, siteHero, siteHow, siteDay, siteLid, siteCards, sitePricing, siteApproval, sitePages, siteSprites],
};

export default section;
