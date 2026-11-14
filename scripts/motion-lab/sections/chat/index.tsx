import type { Section } from "@lab/types";
import "@/components/chat.css";
import "./chat-lab.css";
import { chatSwitch } from "./items/switch";
import { sending } from "./items/send";
import { streaming } from "./items/streaming";
import { thinking } from "./items/thinking";
import { typing } from "./items/typing";
import { tools } from "./items/tools";
import { activity } from "./items/activity";
import { arrival } from "./items/arrival";
import { reaction } from "./items/reaction";
import { jump } from "./items/jump";
import { empty } from "./items/empty";

const section: Section = {
  id: "chat",
  title: "Chat",
  order: 10,
  items: [chatSwitch, sending, streaming, thinking, typing, tools, activity, arrival, reaction, jump, empty],
};

export default section;
