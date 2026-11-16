import {
  DEMO_VALUE_MAX_WIRE, demoBlanksOf, demoStepHasValue, isDemoBlankName,
  type DemoDraft, type DemoPlace, type DemoRecording, type DemoStep,
} from "../../shared/demo-recording.ts";
import { DemoCapture } from "./capture.ts";
import { compileDemo, demoTitle, type DemoNamer } from "./compile.ts";
import { normaliseDemo } from "./normalise.ts";
import type { DemoPagePort } from "./ports.ts";
import { DEMO_REPLAY_TOOL, renderDemoSkill, type DemoSkillFiles } from "./skill-file.ts";

export interface DemoRecorderDeps {
  /** The page the person is showing the task on, or why it cannot be read. */
  port(botId: string, place: DemoPlace): Promise<Pick<DemoPagePort, "evaluate" | "everyDocument"> | { refusal: string }>;
  /** Whether the person holds control there: nothing is recorded unless they do. */
  held(botId: string, place: DemoPlace): boolean;
  nameBlanks?(botId: string): DemoNamer;
  /** Saves the skill for the bot, enabled; the name it was saved under. */
  saveSkill(botId: string, skill: DemoSkillFiles): { name: string } | { error: string };
  /** Sets up a routine that runs `prompt`, switched off; its id. */
  createRoutine?(botId: string, routine: { name: string; prompt: string }): { id: string } | { error: string };
  /** Told of every change to a bot's draft. */
  changed?(draft: DemoDraft): void;
  scrub?(text: string): string;
  log?(line: string): void;
  pollMs?: number;
  now?: () => number;
}

export type DemoStepPatch = { blank: string | null } | { value: string };
export type DemoSaveResult = { skill: string; routineId?: string; routineError?: string } | { error: string };

export const DEMO_NOT_HELD = "Take control first: a task is recorded only while you are the one using the browser.";
export const DEMO_NOTHING_RECORDED = "Nothing has been recorded yet.";

interface Session {
  place: DemoPlace;
  state: "recording" | "review";
  startedAt: number;
  capture: DemoCapture | null;
  /** While recording: the steps the person deleted, and the blanks and values they chose, by step id. */
  deleted: Set<string>;
  blanks: Map<string, string | null>;
  values: Map<string, string>;
  /** Once reviewed: the steps as they will be saved. */
  steps: DemoStep[];
  title: string;
  named: DemoDraft["named"];
  /** What the app was last told, so an unchanged list is not announced again. */
  told: string;
}

/** Each bot's recording while it is made and reviewed. In memory on purpose: a draft is a person's unsaved work, and what is saved is a skill. */
export class DemoRecorder {
  readonly #deps: DemoRecorderDeps;
  readonly #sessions = new Map<string, Session>();
  readonly #revisions = new Map<string, number>();

  constructor(deps: DemoRecorderDeps) {
    this.#deps = deps;
  }

  #steps(session: Session): DemoStep[] {
    if (session.state === "review" || !session.capture) return session.steps;
    return normaliseDemo(session.capture.events())
      .filter((step) => !session.deleted.has(step.id))
      .map((step) => {
        const blank = session.blanks.get(step.id);
        const value = session.values.get(step.id);
        return { ...step, ...(value !== undefined && step.value !== undefined ? { value } : {}), ...(blank && demoStepHasValue(step) ? { blank } : {}) };
      });
  }

  #view(botId: string, session: Session | undefined): Omit<DemoDraft, "revision"> {
    if (!session) return { botId, state: "idle", place: "browser", startedAt: null, title: "", startUrl: "", steps: [], blanks: [], named: null };
    const steps = this.#steps(session);
    return {
      botId, state: session.state, place: session.place, startedAt: session.startedAt, title: session.title,
      startUrl: steps.find((step) => step.kind === "open")?.url ?? "", steps, blanks: demoBlanksOf(steps), named: session.named,
    };
  }

  draft(botId: string): DemoDraft {
    return { ...this.#view(botId, this.#sessions.get(botId)), revision: this.#revisions.get(botId) ?? 0 };
  }

  /** Announces the draft when it is not what the app last saw. */
  #announce(botId: string): DemoDraft {
    const session = this.#sessions.get(botId);
    const view = this.#view(botId, session);
    const text = JSON.stringify(view);
    if (session && session.told === text) return this.draft(botId);
    if (session) session.told = text;
    const revision = (this.#revisions.get(botId) ?? 0) + 1;
    this.#revisions.set(botId, revision);
    const draft = { ...view, revision };
    try { this.#deps.changed?.(draft); } catch {}
    return draft;
  }

  async start(botId: string, place: DemoPlace): Promise<DemoDraft | { error: string }> {
    const current = this.#sessions.get(botId);
    if (current?.state === "recording") return this.draft(botId);
    if (!this.#deps.held(botId, place)) return { error: DEMO_NOT_HELD };
    const port = await this.#deps.port(botId, place);
    if ("refusal" in port) return { error: port.refusal };
    const capture = new DemoCapture(port, {
      ...(this.#deps.pollMs === undefined ? {} : { pollMs: this.#deps.pollMs }),
      ...(this.#deps.scrub ? { scrub: this.#deps.scrub } : {}),
      ...(this.#deps.log ? { log: this.#deps.log } : {}),
      onEvents: () => { if (this.#sessions.get(botId)?.capture === capture) this.#announce(botId); },
    });
    const session: Session = {
      place, state: "recording", startedAt: (this.#deps.now ?? Date.now)(), capture, deleted: new Set(), blanks: new Map(), values: new Map(),
      steps: [], title: "", named: null, told: "",
    };
    this.#sessions.set(botId, session);
    await capture.start();
    if (this.#sessions.get(botId) !== session) return this.draft(botId);
    return this.#announce(botId);
  }

  /** Reads the page now, so the list shows what was just done. */
  async sync(botId: string): Promise<DemoDraft> {
    const session = this.#sessions.get(botId);
    if (session?.state === "recording" && session.capture) await session.capture.drain();
    return this.#sessions.get(botId) === session ? this.#announce(botId) : this.draft(botId);
  }

  /** Stops recording and names the blanks, leaving the steps to review. */
  async stop(botId: string): Promise<DemoDraft> {
    const session = this.#sessions.get(botId);
    if (!session || session.state !== "recording" || !session.capture) return this.draft(botId);
    const capture = session.capture;
    await capture.stop();
    if (this.#sessions.get(botId) !== session) return this.draft(botId);
    const steps = this.#steps(session);
    if (!steps.length) {
      this.#sessions.delete(botId);
      return this.#announce(botId);
    }
    const namer = this.#deps.nameBlanks?.(botId);
    const { recording, named } = await compileDemo(steps, { ...(namer ? { nameBlanks: namer } : {}), keep: session.blanks, ...(session.title ? { title: session.title } : {}) });
    if (this.#sessions.get(botId) !== session) return this.draft(botId);
    session.capture = null;
    session.state = "review";
    session.steps = recording.steps;
    session.title = recording.title;
    session.named = named;
    return this.#announce(botId);
  }

  #editable(botId: string, stepId?: string): { session: Session; step?: DemoStep } | { error: string } {
    const session = this.#sessions.get(botId);
    if (!session) return { error: DEMO_NOTHING_RECORDED };
    if (stepId === undefined) return { session };
    const step = this.#steps(session).find((candidate) => candidate.id === stepId);
    return step ? { session, step } : { error: "That step is no longer in the list." };
  }

  patchStep(botId: string, stepId: string, patch: DemoStepPatch): DemoDraft | { error: string } {
    const found = this.#editable(botId, stepId);
    if ("error" in found) return found;
    const { session } = found;
    const step = found.step!;
    if ("blank" in patch) {
      if (!demoStepHasValue(step)) return { error: "Only a step that holds a value can be a blank." };
      if (patch.blank !== null && !isDemoBlankName(patch.blank)) return { error: "A blank's name is lowercase words joined by underscores, such as expense_date." };
      if (session.state === "review") {
        session.steps = session.steps.map((candidate) => {
          if (candidate.id !== stepId) return candidate;
          const { blank: _blank, ...rest } = candidate;
          return patch.blank === null ? rest : { ...rest, blank: patch.blank };
        });
      } else {
        session.blanks.set(stepId, patch.blank);
      }
      return this.#announce(botId);
    }
    if (!demoStepHasValue(step) || step.kind === "check" || typeof patch.value !== "string") return { error: "This step holds no value to change." };
    const value = patch.value.slice(0, DEMO_VALUE_MAX_WIRE);
    if (session.state === "review") session.steps = session.steps.map((candidate) => (candidate.id === stepId ? { ...candidate, value } : candidate));
    else session.values.set(stepId, value);
    return this.#announce(botId);
  }

  /** Renames a blank everywhere it is used. */
  renameBlank(botId: string, from: string, to: string): DemoDraft | { error: string } {
    const found = this.#editable(botId);
    if ("error" in found) return found;
    const { session } = found;
    const steps = this.#steps(session);
    if (!steps.some((step) => step.blank === from)) return { error: "There is no blank with that name." };
    if (!isDemoBlankName(to)) return { error: "A blank's name is lowercase words joined by underscores, such as expense_date." };
    if (to !== from && steps.some((step) => step.blank === to)) return { error: "Another blank already has that name." };
    if (session.state === "review") session.steps = session.steps.map((step) => (step.blank === from ? { ...step, blank: to } : step));
    else for (const step of steps) if (step.blank === from) session.blanks.set(step.id, to);
    return this.#announce(botId);
  }

  deleteStep(botId: string, stepId: string): DemoDraft | { error: string } {
    const found = this.#editable(botId, stepId);
    if ("error" in found) return found;
    if (found.session.state === "review") found.session.steps = found.session.steps.filter((step) => step.id !== stepId);
    else found.session.deleted.add(stepId);
    return this.#announce(botId);
  }

  setTitle(botId: string, title: string): DemoDraft | { error: string } {
    const found = this.#editable(botId);
    if ("error" in found) return found;
    const clean = demoTitle(title);
    if (!clean) return { error: "Give the task a name." };
    found.session.title = clean;
    return this.#announce(botId);
  }

  discard(botId: string): DemoDraft {
    const session = this.#sessions.get(botId);
    if (!session) return this.draft(botId);
    this.#sessions.delete(botId);
    void session.capture?.stop().catch(() => undefined);
    return this.#announce(botId);
  }

  async save(botId: string, as: "skill" | "routine", options: { folder?: string } = {}): Promise<DemoSaveResult> {
    if (this.#sessions.get(botId)?.state === "recording") await this.stop(botId);
    const session = this.#sessions.get(botId);
    if (!session || session.state !== "review" || !session.steps.length) return { error: DEMO_NOTHING_RECORDED };
    const recording: DemoRecording = {
      v: 1, title: session.title, startUrl: session.steps.find((step) => step.kind === "open")?.url ?? "", steps: session.steps, blanks: demoBlanksOf(session.steps),
    };
    const skill = renderDemoSkill(recording);
    const saved = this.#deps.saveSkill(botId, skill);
    if ("error" in saved) return saved;
    let routine: { id: string } | { error: string } | null = null;
    if (as === "routine") {
      const folder = options.folder?.trim();
      const prompt = folder
        ? `Use your ${saved.name} skill. Call ${DEMO_REPLAY_TOOL} with skill "${saved.name}" and folder ${JSON.stringify(folder)} to run it once for every input file in that folder. Then tell me which ones were done and which were not, and why.`
        : `Use your ${saved.name} skill. Call ${DEMO_REPLAY_TOOL} with skill "${saved.name}" and the inputs it lists. If you do not have a value for every input, ask me before you start.`;
      routine = this.#deps.createRoutine?.(botId, { name: recording.title, prompt }) ?? { error: "Routines are not available here." };
    }
    if (this.#sessions.get(botId) === session) {
      this.#sessions.delete(botId);
      this.#announce(botId);
    }
    if (!routine) return { skill: saved.name };
    return "error" in routine ? { skill: saved.name, routineError: routine.error } : { skill: saved.name, routineId: routine.id };
  }

  /** The person handed control back: recording ends, and what was recorded stays for review. */
  async released(botId: string, place: DemoPlace): Promise<void> {
    const session = this.#sessions.get(botId);
    if (session?.state === "recording" && session.place === place) await this.stop(botId);
  }

  /** The bots with a recording under way, for a control hand-back that names no bot. */
  recording(): Array<{ botId: string; place: DemoPlace }> {
    return [...this.#sessions].filter(([, session]) => session.state === "recording").map(([botId, session]) => ({ botId, place: session.place }));
  }
}
