import type { Run, SiteTask } from "./site.ts";

export const GROUPS = ["composers", "lists", "widgets", "frames", "overlays", "flows", "files"] as const;
export type Group = (typeof GROUPS)[number];

export interface TaskContext {
  base: string;
  cross: string;
  /** A folder the bot may upload from, holding the task's files. */
  files: string;
}

export interface Verdict { pass: boolean; why: string }

/** One browser tool call for a scripted solution; it throws on an error result. */
export type Call = (name: string, args?: Record<string, unknown>) => Promise<string>;

export interface BenchTask extends SiteTask {
  group: Group;
  title: string;
  /** The page the bot is told to start on, relative to the run's base. */
  start: string;
  request(context: TaskContext): string;
  /** Files the task needs in the bot's folder: name to contents. */
  files?: Record<string, string>;
  check(run: Run, answer: string): Verdict;
  /** A known way through with the bot's own tools; it returns the answer a bot would give. */
  solve(call: Call, context: TaskContext): Promise<string>;
}

export const verdict = (pass: boolean, why: string): Verdict => ({ pass, why });

export function lastEvent(run: Run, type: string): Record<string, unknown> | null {
  return [...run.events].reverse().find((event) => event.type === type) ?? null;
}

const digits = (text: string) => text.replace(/[^\d.]/gu, "");

/** The answer names `wanted`, compared without case, spaces or thousands separators. */
export function answerHas(answer: string, wanted: string): Verdict {
  const norm = (text: string) => text.toLowerCase().replace(/[\s,]/gu, "");
  return verdict(norm(answer).includes(norm(wanted)), norm(answer).includes(norm(wanted)) ? `answer names ${wanted}` : `answer does not name ${wanted}`);
}

export { digits };
