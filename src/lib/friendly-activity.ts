import type { LocaleKey } from "@/locales";
import type { Message } from "@/state/store";
import type { LiveStatus } from "@/state/turn-status";
import { t, tOptional } from "./i18n";
import { turnNowPhrases, type LiveActivityPhrases } from "./live-activity";

// The working line's words, all in one place. A pool's `base` words are said in every language and its `extra` words
// only where the active language has them; its `core` words replace the base wherever the language has them.
const CORE: LocaleKey[] = [
  "chat.friendly.pool.cooking", "chat.friendly.pool.lockingIn", "chat.friendly.pool.brewing", "chat.friendly.pool.noodling",
  "chat.friendly.pool.tinkering", "chat.friendly.pool.scheming", "chat.friendly.pool.plotting", "chat.friendly.pool.pondering",
  "chat.friendly.pool.vibing", "chat.friendly.pool.mulling", "chat.friendly.pool.untangling", "chat.friendly.pool.doodling",
  "chat.friendly.pool.stirringThePot", "chat.friendly.pool.crunching", "chat.friendly.pool.rummaging", "chat.friendly.pool.puzzling",
  "chat.friendly.pool.sketching", "chat.friendly.pool.wrangling", "chat.friendly.pool.fiddling", "chat.friendly.pool.spelunking",
  "chat.friendly.pool.moonlighting", "chat.friendly.pool.stargazing", "chat.friendly.pool.nightShifting", "chat.friendly.pool.connectingDots",
  "chat.friendly.pool.bigBrainTime", "chat.friendly.pool.inTheZone", "chat.friendly.pool.deepInIt", "chat.friendly.pool.lowKeyGrinding",
  "chat.friendly.pool.liningItUp", "chat.friendly.pool.polishing", "chat.friendly.pool.chewingOnIt", "chat.friendly.pool.spinningUp",
  "chat.friendly.pool.warmingUp", "chat.friendly.pool.juggling", "chat.friendly.pool.hatchingAPlan", "chat.friendly.pool.herdingThoughts",
  "chat.friendly.pool.sleuthing", "chat.friendly.pool.crackingIt", "chat.friendly.pool.almostCooked", "chat.friendly.pool.platingIt",
];

type Pool = { base: LocaleKey[]; extra?: LocaleKey[]; core?: LocaleKey[] };

export const WORD_POOLS = {
  thinking: { base: ["chat.friendly.thinking", "chat.friendly.mulling", "chat.friendly.puttingTogether"], core: CORE },
  generic: { base: ["chat.friendly.working", "chat.friendly.chipping", "chat.friendly.gettingDone", "chat.friendly.progress", "chat.friendly.handling"], core: CORE },
  // "Typing…" first: a bubble's short typing beat says only that
  typing: { base: ["chat.typing"], extra: ["chat.friendly.pool.writing", "chat.friendly.pool.wordsmithing", "chat.friendly.pool.typingItUp", "chat.friendly.pool.platingIt", "chat.friendly.pool.finishingTouches", "chat.friendly.pool.wrappingUp"] },
  digging: { base: ["chat.friendly.digging"], extra: ["chat.friendly.pool.rummaging", "chat.friendly.pool.sleuthing"] },
  web: { base: ["chat.friendly.digging"], extra: ["chat.friendly.pool.digging", "chat.friendly.pool.snoopingAround", "chat.friendly.pool.scouting", "chat.friendly.pool.combingTheWeb"] },
  page: { base: ["chat.friendly.digging"], extra: ["chat.friendly.pool.skimming", "chat.friendly.pool.speedReading"] },
  code: { base: ["chat.friendly.code"], extra: ["chat.friendly.pool.tinkering", "chat.friendly.pool.wrangling"] },
  commands: { base: ["chat.friendly.commands"], extra: ["chat.friendly.pool.tinkering", "chat.friendly.pool.crunching"] },
  clicking: { base: ["chat.friendly.clicking"], extra: ["chat.friendly.pool.drivingTheMouse"] },
  team: { base: ["chat.friendly.team"], extra: ["chat.friendly.pool.loopingInATeammate"] },
  publish: { base: ["chat.activity.publishPage"] },
} satisfies Record<string, Pool>;

export type PoolName = keyof typeof WORD_POOLS;

/** A pool's words in the active language, its first word first. */
export function poolWords(name: PoolName): string[] {
  const pool: Pool = WORD_POOLS[name];
  const core = (pool.core ?? []).flatMap((key) => tOptional(key) ?? []);
  const words = core.length > 0 ? core : [...pool.base.map((key) => t(key)), ...(pool.extra ?? []).flatMap((key) => tOptional(key) ?? [])];
  return [...new Set(words)];
}

// a command, search or page is said by its kind, never by the command or address itself
const STEP_POOLS: Record<string, PoolName> = { command: "commands", web: "web", fetch: "page" };

const BY_PHASE: Array<[readonly string[], PoolName]> = [
  [["chat.activity.reply"], "typing"],
  [["chat.activity.searchWeb"], "web"],
  [["chat.activity.readPage"], "page"],
  [["chat.activity.readFile", "chat.activity.searching"], "digging"],
  [["chat.activity.writeFile", "chat.activity.editFile"], "code"],
  [["chat.activity.runCommand"], "commands"],
  [["chat.activity.screen", "chat.activity.computer", "chat.activity.openPage"], "clicking"],
  [["chat.activity.handoff", "chat.activity.askTeammate", "chat.activity.postRoom", "chat.activity.messagePerson", "chat.activity.rooms", "chat.activity.whosAround"], "team"],
  [["chat.activity.publishPage"], "publish"],
];

/** Servers of the app's own tools: their work reads as what it does, never as "Working in …". */
const OWN_SERVERS = new Set(["dusk", "agents", "ogb", "omb", "duskbot", "computer", "browser", "harness"]);

/** The outside service a tool call works in, by its MCP server or a connected-app tool's name, as a person names it. */
export function toolService(name: string | undefined): string | null {
  const server = /^mcp__([^_]+(?:-[^_]+)*)__(.+)$/.exec(name ?? "");
  if (!server) return null;
  const [, id, tool] = server;
  if (OWN_SERVERS.has(id!.toLowerCase())) return null;
  const raw = id!.toLowerCase() === "composio" ? /^([A-Za-z]+)_/.exec(tool!)?.[1] : id;
  if (!raw) return null;
  return raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
}

/** The typing pool's phase is the line's own "Typing…" phase, which comes and goes at once. */
export const TYPING_PHASE = "friendly:chat.typing";

/** A pool with no lead phrase: its words start anywhere in the turn. Every other pool says what the step is first. */
export function startsAnywhere(phase: string): boolean {
  return phase === "friendly:generic" || phase === "friendly:thinking";
}

function phrases(name: PoolName): LiveActivityPhrases {
  return { phase: name === "typing" ? TYPING_PHASE : `friendly:${name}`, phrases: poolWords(name) };
}

/** Simple mode's rotating line for what the bot is doing now: plain words in place of file names, sizes and timers,
 * chosen by the kind of step (a tool's spoken narration is read by its name, as every other step is). */
export function friendlyNowPhrases(status: LiveStatus | null, message?: Message): LiveActivityPhrases {
  const plain = message?.kind === "activity" && message.tool?.spoken ? { ...message, tool: { ...message.tool, spoken: undefined } } : message;
  const now = turnNowPhrases(status, plain);
  if (now?.phase.startsWith("notice:")) return now;
  if (now?.phase.startsWith("step:")) {
    const name = STEP_POOLS[now.phase.split(":")[1] ?? ""];
    return name ? phrases(name) : now;
  }
  const tool = (status && "tool" in status ? status.tool : undefined) ?? (message?.kind === "activity" && message.tool?.ok === undefined ? message.tool?.name : undefined);
  const service = toolService(tool);
  if (service) return { phase: `friendly:service:${service}`, phrases: [t("chat.friendly.service", { service })] };
  if (!now) return phrases("generic");
  if (now.phase === "chat.activity.thinking") return phrases("thinking");
  if (now.phase.startsWith("live:read:")) return phrases("digging");
  if (now.phase.startsWith("live:")) return phrases("code");
  const match = BY_PHASE.find(([phases]) => phases.includes(now.phase));
  return phrases(match ? match[1] : "generic");
}
