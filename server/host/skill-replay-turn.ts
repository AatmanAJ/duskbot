// skill_replay for one turn: a skill that was shown once, run by the server in the bot's own browser as one browser
// action, answered in words. Where the page no longer matches, the answer says what is left and the bot's own browser
// tools take over. Security: a sign-in step is typed by the Vault as fill_login does, input files are read only from
// folders the conversation may read, and a file reaches a page only through the same check as agent_browser_upload.
import { isAbsolute, resolve } from "node:path";

import type { DemoRecording } from "../../shared/demo-recording.ts";
import type { Surface } from "../../shared/wire.ts";
import type { BotLogins } from "../bot-logins.ts";
import { BROWSER_CONTROL_REFUSAL } from "../browser-runtime.ts";
import type { SecretHold } from "../browser-secret-hold.ts";
import type { StepContext } from "../browser-steps.ts";
import { replayBatch } from "../demo-recorder/batch.ts";
import { matchInputs, readInputFolder, type InputRecord } from "../demo-recorder/inputs.ts";
import { demoPortOf, type DemoPagePort, type LoginInput } from "../demo-recorder/ports.ts";
import { ReplayInterrupted, replayDemo } from "../demo-recorder/replay.ts";
import { DEMO_REPLAY_TOOL } from "../demo-recorder/skill-file.ts";
import { fillLogin, type FillLoginDeps } from "../login-fill.ts";
import { redactSecretsInText } from "../redact.ts";
import type { BotRecord } from "../store.ts";
import type { DesktopLogin } from "./fill-login-turn.ts";
import type { DemoBrowser } from "./show-it-once.ts";

type Turn = { botId: string; threadId: string; generation: string };
type Answer = { ok: boolean; text: string; held?: SecretHold };

/** A folder run gives its answer within this long; what is left is named for another call. */
export const REPLAY_BUDGET_MS = 4 * 60_000;
const INPUT_KEYS_MAX = 80;

export interface SkillReplayTurnDeps<T extends Turn = Turn> {
  place(bot: BotRecord, threadId: string): Surface | null;
  current(bot: BotRecord, threadId: string): BotRecord;
  builtInBrowserOn(): boolean;
  /** Null while the browser is not installed. */
  target(bot: BotRecord, threadId: string): Promise<DemoBrowser | null>;
  claim(turn: Turn, resource: string): boolean;
  /** Runs `work` as the browser's one action; throws the control refusal while a person holds the browser. */
  inLane(browser: DemoBrowser, work: () => Promise<Answer>, ctx: StepContext): Promise<Answer>;
  /** Whether a person holds that browser or has asked for it. */
  held(browser: DemoBrowser): boolean;
  port(browser: DemoBrowser): DemoPagePort;
  loginInput(browser: DemoBrowser): LoginInput;
  /** The recording an enabled skill of this bot holds. */
  recording(bot: BotRecord, skill: string): DemoRecording | { error: string };
  logins: Pick<BotLogins, "candidates" | "sitesFor" | "markUsed">;
  onePasswordTrouble(): string | undefined;
  remember: FillLoginDeps["remember"];
  /** A file the conversation may hand to a page, as the path its browser reads, or null. */
  uploadable(bot: BotRecord, turn: Turn, file: string, browser: DemoBrowser | null): Promise<string | null>;
  /** A folder the conversation may read input files from, as its real path, or null. */
  readableFolder(bot: BotRecord, turn: Turn, folder: string): string | null;
  /** Throws once the turn has ended. */
  stillActive(turn: T): void;
  stepContext(bot: BotRecord, turn: Turn): StepContext;
  /** The Chromium on the bot's own computer, as fill_login reaches it. */
  desktop?(bot: BotRecord, turn: T): Promise<DesktopLogin | { refusal: string } | null>;
  now?: () => number;
  budgetMs?: number;
}

export interface SkillReplayArgs {
  skill?: unknown;
  inputs?: unknown;
  folder?: unknown;
  skip?: unknown;
  from_step?: unknown;
}

function stringMap(value: unknown): Record<string, string> | null {
  if (value === undefined || value === null) return {};
  if (typeof value !== "object" || Array.isArray(value)) return null;
  const entries = Object.entries(value);
  if (entries.length > INPUT_KEYS_MAX) return null;
  const map: Record<string, string> = {};
  for (const [key, inner] of entries) {
    if (typeof inner === "string") map[key] = inner.slice(0, 2_000);
    else if (typeof inner === "number" || typeof inner === "boolean") map[key] = typeof inner === "boolean" ? (inner ? "yes" : "no") : String(inner);
    else return null;
  }
  return map;
}

export function createSkillReplayTurn<T extends Turn = Turn>(deps: SkillReplayTurnDeps<T>) {
  const now = deps.now ?? Date.now;

  /** The sign-in step: the saved login for the page in front, typed the way fill_login types it. */
  function vault(bot: BotRecord, input: LoginInput, onHeld: (held: SecretHold | undefined) => void) {
    return async (): Promise<{ ok: boolean; text: string }> => {
      const outcome = await fillLogin({
        submit: true,
        candidates: (host) => deps.logins.candidates(bot.id, host),
        available: async () => deps.logins.sitesFor(bot.id),
        trouble: deps.onePasswordTrouble,
      }, { ...input, remember: deps.remember });
      if (outcome.ok && outcome.loginId) deps.logins.markUsed(outcome.loginId);
      onHeld(outcome.held);
      return { ok: outcome.ok, text: outcome.text };
    };
  }

  async function run(bot: BotRecord, turn: T, recording: DemoRecording, args: SkillReplayArgs, port: DemoPagePort, input: LoginInput, browser: DemoBrowser | null): Promise<Answer> {
    let held: SecretHold | undefined;
    const common = {
      signIn: vault(bot, input, (hold) => { held = hold ?? held; }),
      checkpoint: () => deps.stillActive(turn),
      yielded: () => browser !== null && deps.held(browser),
    };
    const fileBlanks = recording.blanks.filter((blank) => blank.kind === "file").map((blank) => blank.name);

    if (typeof args.folder === "string" && args.folder.trim()) {
      const folder = deps.readableFolder(bot, turn, args.folder.trim());
      if (!folder) return { ok: false, text: `Nothing was done: ${args.folder.trim().slice(0, 200)} is not a folder this conversation can read. Use a folder in your working folder, or ask the person to attach the files.` };
      const skip = Array.isArray(args.skip) ? args.skip.filter((name): name is string => typeof name === "string").slice(0, 500) : [];
      const { records, skipped } = readInputFolder(folder, recording.blanks, { except: skip });
      if (!records.length) {
        const why = skipped.length ? ` ${skipped.slice(0, 5).map((entry) => entry.reason).join(" ")}` : "";
        return { ok: false, text: `Nothing was done: ${args.folder.trim().slice(0, 200)} holds no input file for this skill (.json, .csv, .tsv, .yaml, .yml, .txt or .md with a value for ${recording.blanks.map((blank) => `\`${blank.name}\``).join(", ") || "its inputs"}).${why}` };
      }
      // A file a record names is checked once, here, before any page is touched.
      const files = new Map<string, string | null>();
      for (const record of records) {
        const { inputs } = matchInputs(recording.blanks, record);
        for (const name of fileBlanks) {
          const value = inputs[name];
          if (!value || files.has(`${record.source}\n${value}`)) continue;
          const path = isAbsolute(value) ? value : resolve(record.folder ?? folder, value);
          files.set(`${record.source}\n${value}`, await deps.uploadable(bot, turn, path, browser));
        }
      }
      const until = now() + (deps.budgetMs ?? REPLAY_BUDGET_MS);
      const outcome = await replayBatch(port, recording, records, {
        ...common,
        resolveFile: (value: string, record: InputRecord) => files.get(`${record.source}\n${value}`) ?? null,
        goOn: () => now() < until,
      });
      const left = skipped.length ? `\nNot read: ${skipped.slice(0, 10).map((entry) => entry.reason).join(" ")}` : "";
      return { ok: outcome.ok, text: `${outcome.text}${left}`, ...(held ? { held } : {}) };
    }

    const given = stringMap(args.inputs);
    if (!given) return { ok: false, text: `Nothing was done: inputs must be an object of text values, such as {"amount": "18.40"}.` };
    const { inputs } = matchInputs(recording.blanks, { source: "inputs", values: given });
    for (const name of fileBlanks) {
      const value = inputs[name];
      if (!value) continue;
      const path = isAbsolute(value) ? await deps.uploadable(bot, turn, value, browser) : null;
      if (!path) return { ok: false, text: `Nothing was done: the file for \`${name}\` must be the full path of one of this conversation's attachments or a file in your working folder.` };
      inputs[name] = path;
    }
    const outcome = await replayDemo(port, recording, inputs, {
      ...common,
      resolveFile: (value) => value,
      ...(typeof args.from_step === "string" && args.from_step ? { fromStep: args.from_step.slice(0, 16) } : {}),
    });
    return { ok: outcome.ok, text: outcome.text, ...(held ? { held } : {}) };
  }

  async function replayForTurn(bot: BotRecord, turn: T, args: SkillReplayArgs): Promise<{ ok: boolean; text: string }> {
    const skill = typeof args.skill === "string" ? args.skill.trim().slice(0, 64) : "";
    if (!skill) return { ok: false, text: `${DEMO_REPLAY_TOOL} needs skill: the name of a skill that was shown once, as skills_list shows it.` };
    const recording = deps.recording(bot, skill);
    if ("error" in recording) return { ok: false, text: recording.error };
    const threadId = turn.threadId;
    const place = deps.place(bot, threadId);
    const current = deps.current(bot, threadId);
    const failed = (error: unknown): { ok: boolean; text: string } => {
      if (error instanceof Error && (error.message === BROWSER_CONTROL_REFUSAL || error instanceof ReplayInterrupted)) {
        return { ok: false, text: `The person is using this browser right now, so the run stopped. Wait for them to hand it back, look at the page, then call ${DEMO_REPLAY_TOOL} again.` };
      }
      throw error;
    };

    if (place === "cloud" && deps.desktop) {
      let opened: DesktopLogin | { refusal: string } | null;
      try { opened = await deps.desktop(current, turn); } catch (error) {
        return { ok: false, text: `Could not reach Chromium on your computer: ${redactSecretsInText(error instanceof Error ? error.message : String(error))} Follow the skill's steps by hand, or call ${DEMO_REPLAY_TOOL} again in a moment.` };
      }
      if (opened && "refusal" in opened) return { ok: false, text: opened.refusal.replaceAll("fill_login", DEMO_REPLAY_TOOL) };
      if (opened) {
        let answer: Answer | undefined;
        try {
          answer = await run(bot, turn, recording, args, demoPortOf(opened.input), opened.input, null);
          return { ok: answer.ok, text: answer.text };
        } catch (error) {
          return failed(error);
        } finally {
          opened.finish(answer?.held);
        }
      }
    }
    if (place !== "browser") {
      return { ok: false, text: `${DEMO_REPLAY_TOOL} runs in your own browser, and this conversation is not working there. Call select_computer to work in your browser and call it again on your next turn, or follow the skill's steps by hand where you are.` };
    }
    if (current.browser === false || current.computer === "off" || !deps.builtInBrowserOn()) {
      return { ok: false, text: `The built-in browser is off for you here, so ${DEMO_REPLAY_TOOL} has nowhere to run.` };
    }
    const browser = await deps.target(current, threadId);
    if (!browser) return { ok: false, text: "The browser is not available on this computer right now." };
    if (!deps.claim(turn, `browser:${browser.session}`)) {
      return { ok: false, text: `Another conversation is using this browser. Wait until it finishes, then call ${DEMO_REPLAY_TOOL} again.` };
    }
    // What the run did is told even when the person has the browser by the time it ends: a run reported as never
    // started would be started again, and file the same things twice.
    let ran: Answer | undefined;
    try {
      const answer = await deps.inLane(browser, async () => (ran = await run(bot, turn, recording, args, deps.port(browser), deps.loginInput(browser), browser)), deps.stepContext(current, turn));
      return { ok: answer.ok, text: answer.text };
    } catch (error) {
      if (ran && error instanceof Error && error.message === BROWSER_CONTROL_REFUSAL) return { ok: ran.ok, text: ran.text };
      return failed(error);
    }
  }

  return { replayForTurn };
}
