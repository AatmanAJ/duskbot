import type { Section } from "@lab/types";
import "./kit/flows.css";
import { account } from "./account";
import { buttons } from "./buttons";
import { connect } from "./connect";
import { intent } from "./intent";
import { plans } from "./plans";
import { setupCard } from "./setup-card";
import { steps } from "./steps";
import { update } from "./update";

const section: Section = {
  id: "flows",
  title: "flows",
  order: 30,
  items: [steps, connect, account, plans, setupCard, buttons, update, intent],
};

export default section;
