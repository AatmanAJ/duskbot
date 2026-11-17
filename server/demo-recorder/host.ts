import { randomUUID } from "node:crypto";

import type { DemoBlank, DemoChange, DemoRecording, DemoReplayRun } from "../../shared/demo-recording.ts";
import type { DemoTap } from "../browser/viewers/demo-tap.ts";
import type { AccessibilityProbe, ScreenSource } from "./capture.ts";
import type { DemoEngine } from "./compiler.ts";
import { readDemoInputs, type InputFile } from "./inputs.ts";
import type { DemoRecorder } from "./recorder.ts";
import type { ReplaySurface, StepActor } from "./replay.ts";

export interface Refusal {
  status: number;
  error: string;
}

/** A bot's browser or computer as a task is shown on it and done again on it. */
export interface DemoSeat {
  probe: AccessibilityProbe;
  screen: ScreenSource;
  surface: ReplaySurface;
  /** Sets, or with null ends, what hears the person's input there. */
  tap(tap: DemoTap | null): void;
  /** The address or window in front, for finding a saved sign-in. */
  where(): string;
  /** Lets go of what the seat holds open, once the showing or the doing again is over. */
  close?(): void;
}

/** `Who` is the person asking, as the server knows them: each sees their own browser of a bot. */
export interface DemoHostDeps<Who> {
  recorder: DemoRecorder;
  /** The bot's browser as this person sees it, on an engine a task can be shown in. */
  browser(botId: string, threadId: string | null, who: Who): Promise<DemoSeat | Refusal>;
  /** The bot's own computer, where it has one a task can be shown on. */
  computer?(botId: string, threadId: string | null, who: Who): Promise<DemoSeat | Refusal>;
  engine(botId: string): DemoEngine | null;
  /** The saved secret a blank stands for on the page in front, from the bot's saved sign-ins. */
  secret?(botId: string, blank: DemoBlank, where: string): string | null;
  /** One turn of the bot's own, and what it answered. */
  turn?(botId: string, threadId: string | undefined, text: string): Promise<string>;
  changed(change: DemoChange): void;
  log?: (line: string) => void;
}

export interface DemoHost<Who> {
  start(botId: string, surface: DemoRecording["surface"], threadId: string | null, who: Who): Promise<DemoRecording | Refusal>;
  stop(botId: string): Promise<DemoRecording | Refusal>;
  cancel(botId: string): Promise<void>;
  /** Reads the inputs out of the files and starts doing the task for each; the answer is the run as it begins. */
  replay(recordingId: string, files: readonly InputFile[], who: Who): Promise<DemoReplayRun | Refusal>;
  run(recordingId: string): DemoReplayRun | null;
  stopReplay(recordingId: string): boolean;
}

const refused = (value: unknown): value is Refusal => typeof value === "object" && value !== null && "status" in value && "error" in value;
const firstLine = (text: string) => text.trim().split(/\r?\n/, 1)[0]?.trim() ?? "";

/** The bot's own computer use as the one a replay hands a step to: one turn for a step, one to look at the result. */
function botActor(turn: NonNullable<DemoHostDeps<unknown>["turn"]>, botId: string, threadId: string | undefined, surface: DemoRecording["surface"]): StepActor {
  const place = surface === "browser" ? "your browser" : "your computer";
  return {
    async attempt(request) {
      const answer = await turn(botId, threadId, [
        `You are doing one step of a task a person showed you once. Do only this step, in ${place}, then stop.`,
        `Step: ${request.step.title}`,
        `Goal: ${request.goal}`,
        `It worked when: ${request.check}.`,
        request.hint ? `A first try by the app did not pass: ${request.hint}` : "",
        "The screen may differ from when it was shown: something may have moved, been renamed, or be covering the page. Deal with that first.",
        "Answer with one line: DONE, or STUCK and why.",
      ].filter(Boolean).join("\n"));
      const said = firstLine(answer);
      return /^\W*stuck\b/i.test(said) ? { ok: false, note: said.slice(0, 300) } : { ok: true };
    },
    async confirm(expectation) {
      const answer = await turn(botId, threadId, `Look at ${place} as it is now and change nothing. Is this true: ${expectation}\nAnswer YES or NO on the first line.`);
      return /^\W*yes\b/i.test(firstLine(answer));
    },
  };
}

export function createDemoHost<Who>(deps: DemoHostDeps<Who>): DemoHost<Who> {
  const { recorder } = deps;
  const seats = new Map<string, DemoSeat>();
  const runs = new Map<string, { run: DemoReplayRun; stop: AbortController }>();

  async function seatFor(botId: string, surface: DemoRecording["surface"], threadId: string | null, who: Who): Promise<DemoSeat | Refusal> {
    if (surface === "computer") return deps.computer ? deps.computer(botId, threadId, who) : { status: 409, error: "Showing a task on this computer is not available here yet. Show it in the bot's browser instead." };
    return deps.browser(botId, threadId, who);
  }

  function leave(botId: string): void {
    const seat = seats.get(botId);
    seat?.tap(null);
    seat?.close?.();
    seats.delete(botId);
  }

  return {
    async start(botId, surface, threadId, who) {
      if (recorder.recording(botId)) return { status: 409, error: "This bot is already being shown a task." };
      const seat = await seatFor(botId, surface, threadId, who);
      if (refused(seat)) return seat;
      const started = recorder.start({ botId, surface, probe: seat.probe, screen: seat.screen, ...(threadId ? { threadId } : {}) });
      if (!("id" in started)) return { status: 409, error: started.error };
      seats.set(botId, seat);
      seat.tap({ input: (raw) => recorder.input(botId, raw) });
      return started;
    },

    async stop(botId) {
      leave(botId);
      const stopped = await recorder.stop(botId);
      return "id" in stopped ? stopped : { status: 409, error: stopped.error };
    },

    async cancel(botId) {
      leave(botId);
      await recorder.cancel(botId);
    },

    async replay(recordingId, files, who) {
      const recording = recorder.get(recordingId);
      if (!recording?.plan || recording.status !== "ready") return { status: 404, error: "That recording has no steps to do again." };
      if (runs.get(recordingId)?.run.status === "running") return { status: 409, error: "This task is already being done again. Stop it first." };
      if (recorder.recording(recording.botId)) return { status: 409, error: "Finish showing the task before doing it again." };
      const { plan, botId } = recording;
      const seat = await seatFor(botId, recording.surface, recording.threadId ?? null, who);
      if (refused(seat)) return seat;
      const items = await readDemoInputs(files, plan.blanks, { engine: deps.engine(botId) });
      if (!items.length) {
        seat.close?.();
        return { status: 422, error: "Those files hold nothing to read inputs from." };
      }
      const run: DemoReplayRun = {
        id: randomUUID(),
        recordingId,
        status: "running",
        items: items.map((item) => ({ id: item.id, label: item.label, status: "waiting", values: item.values, missing: item.missing, byBot: 0 })),
        done: 0,
        failed: 0,
      };
      const stop = new AbortController();
      runs.set(recordingId, { run, stop });
      const tell = () => deps.changed({ botId, run: structuredClone(run) });
      const row = (id: string) => run.items.find((item) => item.id === id);
      const titles = new Map(plan.steps.map((step) => [step.id, step.title]));
      tell();
      void recorder.replay(recordingId, {
        items,
        surface: seat.surface,
        actor: deps.turn ? botActor(deps.turn, botId, recording.threadId, recording.surface) : null,
        secrets: async (name) => {
          const blank = plan.blanks.find((each) => each.name === name);
          return blank && deps.secret ? deps.secret(botId, blank, seat.where()) : null;
        },
        signal: stop.signal,
        onProgress(progress) {
          const item = row(progress.item);
          if (!item) return;
          if (progress.type === "item-start") item.status = "running";
          else if (progress.type === "step-start") item.step = titles.get(progress.step) ?? "";
          else if (progress.type === "step-done") {
            if (progress.via === "bot") item.byBot += 1;
            if (!progress.ok && progress.note) item.note = progress.note;
          } else {
            item.status = progress.ok ? "done" : item.missing.length ? "skipped" : "failed";
            if (progress.ok) delete item.step;
            run.done = run.items.filter((each) => each.status === "done").length;
            run.failed = run.items.filter((each) => each.status === "failed").length;
          }
          tell();
        },
      }).then((report) => {
        if ("items" in report) {
          for (const outcome of report.items) {
            const item = row(outcome.id);
            if (item && item.status === "waiting") item.status = "skipped";
          }
        }
        run.status = stop.signal.aborted ? "stopped" : "done";
        seat.close?.();
        tell();
      }, () => {
        run.status = "stopped";
        seat.close?.();
        tell();
        deps.log?.("demo replay: the run ended on an error");
      });
      return structuredClone(run);
    },

    run(recordingId) {
      const entry = runs.get(recordingId);
      return entry ? structuredClone(entry.run) : null;
    },

    stopReplay(recordingId) {
      const entry = runs.get(recordingId);
      if (!entry || entry.run.status !== "running") return false;
      entry.stop.abort();
      return true;
    },
  };
}
