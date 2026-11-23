import type { NewBotDefaults } from "../../shared/new-bot-defaults.ts";
import type { ReadyBot } from "./ready-bot-kit.ts";
import { assistant, callCoach, designCritic, ops, outreach, research, study, travel, writer } from "./ready-bots-catalog.ts";
import { analyst, bookkeeper, coder, community, inbox, meetingNotes, social, support } from "./ready-bots-work.ts";

export { CLASSIC_ROLE_IDS, READY_BOT_CATEGORIES, type ReadyBot, type ReadyBotCategory } from "./ready-bot-kit.ts";

export const READY_BOTS: ReadyBot[] = [
  assistant, ops, inbox, research, writer, coder, analyst, bookkeeper, meetingNotes, support, community, social, outreach, callCoach,
  designCritic, travel, study,
];

export function readyBot(id: string): ReadyBot | undefined {
  return READY_BOTS.find((bot) => bot.id === id);
}

/** Only who the bot is changes: model, approval level, computer, folder, apps and permissions stay the person's own. */
export function readyBotTemplate(defaults: NewBotDefaults, bot: ReadyBot): NewBotDefaults {
  const template = structuredClone(defaults);
  template.profile = {
    ...template.profile,
    name: bot.name,
    title: bot.title,
    description: bot.description,
    soul: bot.soul,
    color: bot.look.color,
    mascotBody: bot.look.mascotBody,
  };
  for (const [path, text] of Object.entries(bot.notes ?? {})) {
    const own = template.memory[path]?.trimEnd();
    template.memory[path] = own ? `${own}\n${text}` : text;
  }
  template.routines = [...template.routines, ...(bot.routines ?? []).map((routine) => ({ ...routine, enabled: false }))];
  return template;
}

export function matchesReadyBot(bot: ReadyBot, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return [bot.name, bot.title, bot.description, bot.category].some((field) => field.toLowerCase().includes(needle));
}
