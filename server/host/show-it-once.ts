// Show it once in the running app: where a bot's recording reads the page (its own browser on either engine, or the
// Chromium on its own computer), who may record (only the person holding control), and what a saved recording becomes.
// Security: the recorder is handed a page it may only read. It ends by itself when the person hands control back, so
// nothing is read from a page once the bot is the one acting on it.
import type { DemoDraft, DemoPlace, DemoRecording } from "../../shared/demo-recording.ts";
import { isSkillName } from "../../shared/skill-md.ts";
import type { BoxLoginPage } from "../box-login-page.ts";
import type { DemoNamer } from "../demo-recorder/compile.ts";
import { demoPortOf, type DemoPagePort } from "../demo-recorder/ports.ts";
import { DEMO_NOT_HELD, DemoRecorder, type DemoSaveResult, type DemoStepPatch } from "../demo-recorder/recorder.ts";
import { DEMO_REFERENCE_PATH, DEMO_REPLAY_TOOL, parseDemoReference, type DemoSkillFiles } from "../demo-recorder/skill-file.ts";
import { applyStagedSkillWrite, enabledSkillFile, readSkillReferences, rejectStagedSkillWrite, stageSkillWrite } from "../skills.ts";

type Spec = { command: string; env: Record<string, string> };
export interface DemoBrowser { session: string; spec: Spec; env: NodeJS.ProcessEnv }

/** Why a recording could not start or be saved, for the app to say in the person's language. */
export type DemoRefusalCode = "not-held" | "no-browser" | "no-page" | "invalid" | "save-failed";
export interface DemoRefusal { error: string; code: DemoRefusalCode }

export interface ShowItOnceDeps {
  /** The bot's own browser as it runs now, or null when it has none here. */
  browser(botId: string): Promise<DemoBrowser | null>;
  /** Whether a person holds that browser. */
  browserHeld(session: string): boolean;
  browserPort(browser: DemoBrowser): DemoPagePort;
  /** Whether a person holds the bot's computer. */
  computerHeld(botId: string): boolean;
  /** The Chromium on the bot's own computer: its DevTools address, false while it cannot be reached, null when it has none. */
  boxChrome(botId: string): Promise<string | false | null>;
  openBox(httpUrl: string): Promise<BoxLoginPage | { refusal: string }>;
  /** The one AI pass that names the blanks, or null when no AI can answer for this bot. */
  namer(botId: string): DemoNamer | null;
  saveSkill(botId: string, skill: DemoSkillFiles): { name: string } | { error: string };
  createRoutine(botId: string, routine: { name: string; prompt: string }): { id: string } | { error: string };
  /** Tells the app's open windows of a bot's draft. */
  changed(draft: DemoDraft): void;
  scrub(text: string): string;
  log?(line: string): void;
  /** How often a recording checks that the person still holds control. */
  watchMs?: number;
}

/** Where a skill saved from a recording says it came from. */
export const DEMO_SKILL_SOURCE = "learn:show-it-once";

/** Saves a recording as one of the bot's own skills, enabled: the person who showed the task is its review. */
export function saveDemoSkill(botId: string, skill: DemoSkillFiles): { name: string } | { error: string } {
  const staged = stageSkillWrite(botId, { action: "create", files: skill.files, source: DEMO_SKILL_SOURCE });
  if ("error" in staged) return staged;
  const applied = applyStagedSkillWrite(botId, staged.id, { expectedSha256: staged.sha256, expectedReferencesSha256: staged.referencesSha256 ?? null });
  if ("error" in applied) {
    rejectStagedSkillWrite(botId, staged.id);
    return applied;
  }
  return { name: applied.name };
}

/** The recording one of the bot's enabled skills holds, for skill_replay. */
export function demoRecordingOf(botId: string, skill: string, assignedLibrary?: readonly string[]): DemoRecording | { error: string } {
  if (!isSkillName(skill) || enabledSkillFile(botId, skill, assignedLibrary) === null) {
    return { error: `You have no enabled skill named "${skill.slice(0, 64)}". skills_list shows the ones you have.` };
  }
  const reference = readSkillReferences(botId, skill)?.find((file) => file.path === DEMO_REFERENCE_PATH);
  const recording = reference ? parseDemoReference(reference.content) : null;
  return recording ?? { error: `The skill "${skill}" holds no recording, so ${DEMO_REPLAY_TOOL} cannot run it. Follow its SKILL.md by hand.` };
}

const NO_BROWSER = "This bot has no browser to record in here.";
const NO_PAGE = "The browser on this bot's computer could not be reached. Open the page there, then record again.";

export function createShowItOnce(deps: ShowItOnceDeps) {
  /** What each bot's recording reads, kept from Record to the hand-back. */
  const sessions = new Map<string, string>();
  const ports = new Map<string, Pick<DemoPagePort, "evaluate" | "everyDocument">>();
  const closers = new Map<string, () => void>();
  let watch: ReturnType<typeof setInterval> | null = null;

  const held = (botId: string, place: DemoPlace) => {
    if (place === "computer") return deps.computerHeld(botId);
    const session = sessions.get(botId);
    return session !== undefined && deps.browserHeld(session);
  };

  const recorder = new DemoRecorder({
    port: async (botId) => ports.get(botId) ?? { refusal: NO_BROWSER },
    held,
    nameBlanks: (botId) => deps.namer(botId) ?? (async () => null),
    saveSkill: (botId, skill) => deps.saveSkill(botId, skill),
    createRoutine: (botId, routine) => deps.createRoutine(botId, routine),
    changed: (draft) => deps.changed(draft),
    scrub: (text) => deps.scrub(text),
    ...(deps.log ? { log: deps.log } : {}),
  });

  function let_go(botId: string): void {
    ports.delete(botId);
    sessions.delete(botId);
    const close = closers.get(botId);
    closers.delete(botId);
    try { close?.(); } catch {}
  }

  /** Ends every recording whose person no longer holds control: the page is the bot's again from that moment. */
  async function check(): Promise<void> {
    for (const { botId, place } of recorder.recording()) {
      if (held(botId, place)) continue;
      await recorder.released(botId, place).catch(() => undefined);
      let_go(botId);
    }
    if (!recorder.recording().length && watch) {
      clearInterval(watch);
      watch = null;
    }
  }

  async function start(botId: string, place: DemoPlace): Promise<DemoDraft | DemoRefusal> {
    if (recorder.draft(botId).state === "recording") return recorder.draft(botId);
    let_go(botId);
    if (place === "computer") {
      if (!deps.computerHeld(botId)) return { error: DEMO_NOT_HELD, code: "not-held" };
      let url: string | false | null;
      try { url = await deps.boxChrome(botId); } catch { url = false; }
      if (!url) return { error: NO_PAGE, code: "no-page" };
      let page: BoxLoginPage | { refusal: string };
      try { page = await deps.openBox(url); } catch { return { error: NO_PAGE, code: "no-page" }; }
      if ("refusal" in page) return { error: NO_PAGE, code: "no-page" };
      ports.set(botId, demoPortOf(page.input));
      closers.set(botId, () => page.close());
    } else {
      const browser = await deps.browser(botId).catch(() => null);
      if (!browser) return { error: NO_BROWSER, code: "no-browser" };
      sessions.set(botId, browser.session);
      if (!deps.browserHeld(browser.session)) {
        let_go(botId);
        return { error: DEMO_NOT_HELD, code: "not-held" };
      }
      ports.set(botId, deps.browserPort(browser));
    }
    const started = await recorder.start(botId, place);
    if ("error" in started) {
      let_go(botId);
      return { error: started.error, code: started.error === DEMO_NOT_HELD ? "not-held" : "no-page" };
    }
    if (!watch) {
      watch = setInterval(() => void check(), deps.watchMs ?? 1_000);
      watch.unref?.();
    }
    return started;
  }

  async function stop(botId: string): Promise<DemoDraft> {
    const draft = await recorder.stop(botId);
    let_go(botId);
    return draft;
  }

  function discard(botId: string): DemoDraft {
    const draft = recorder.discard(botId);
    let_go(botId);
    return draft;
  }

  async function save(botId: string, as: "skill" | "routine", options: { folder?: string } = {}): Promise<DemoSaveResult | DemoRefusal> {
    const result = await recorder.save(botId, as, options);
    if (recorder.draft(botId).state !== "recording") let_go(botId);
    return "error" in result ? { error: result.error, code: "save-failed" } : result;
  }

  const edited = (result: DemoDraft | { error: string }): DemoDraft | DemoRefusal => ("error" in result ? { error: result.error, code: "invalid" } : result);

  return {
    draft: (botId: string) => recorder.draft(botId),
    start,
    stop,
    discard,
    save,
    patchStep: (botId: string, stepId: string, patch: DemoStepPatch) => edited(recorder.patchStep(botId, stepId, patch)),
    renameBlank: (botId: string, from: string, to: string) => edited(recorder.renameBlank(botId, from, to)),
    deleteStep: (botId: string, stepId: string) => edited(recorder.deleteStep(botId, stepId)),
    setTitle: (botId: string, title: string) => edited(recorder.setTitle(botId, title)),
    /** A bot that is gone: its recording goes with it. */
    forget: (botId: string) => { discard(botId); },
    check,
  };
}

export type ShowItOnce = ReturnType<typeof createShowItOnce>;
