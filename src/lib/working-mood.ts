import { TYPING_PHASE } from "./friendly-activity";

/** How the chat's working mascot carries itself for what the bot is doing now. */
export const WORKING_MOODS = ["thinking", "writing", "searching", "browsing", "running", "reading", "waiting", "error", "done"] as const;
export type WorkingMood = (typeof WORKING_MOODS)[number];

const BY_POOL: Record<string, WorkingMood> = {
  thinking: "thinking",
  generic: "thinking",
  memory: "thinking",
  web: "searching",
  page: "browsing",
  openPage: "browsing",
  browsing: "browsing",
  clicking: "browsing",
  screen: "browsing",
  computer: "browsing",
  form: "writing",
  typingInto: "writing",
  editing: "writing",
  saving: "writing",
  code: "writing",
  publish: "writing",
  commands: "running",
  files: "reading",
  team: "waiting",
};

/** The mood for the working line's `phase` (a friendly pool, a notice, the typing phase). Waiting on the person or on
 * teammates, a step that just failed and the turn's end win over the step itself. */
export function workingMood({ phase, waiting = false, failed = false, done = false }: {
  phase?: string | null;
  waiting?: boolean;
  failed?: boolean;
  done?: boolean;
}): WorkingMood {
  if (done) return "done";
  if (failed || phase?.startsWith("notice:")) return "error";
  if (waiting) return "waiting";
  if (!phase) return "thinking";
  if (phase === TYPING_PHASE) return "writing";
  if (phase.startsWith("friendly:service:")) return "browsing";
  return BY_POOL[phase.startsWith("friendly:") ? phase.slice("friendly:".length) : ""] ?? "thinking";
}
