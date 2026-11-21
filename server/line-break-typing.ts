// cua-driver types a line break in type_text as a Return key event when it synthesizes keys (Chromium, Electron and other
// fields without kAXSelectedText on macOS, and on Windows and Linux), and Return sends the message in X and Instagram
// DMs, WhatsApp, Slack, Telegram, Discord and iMessage: a multi-line message went out one line at a time. agent-browser
// 0.37.0's agent_browser_type does the same (a bare Enter keydown per line break); its press takes "Shift+Enter", and its
// type into the same selector again goes on at the caret.
import { withoutLeakedToolTags } from "../electron/paced-typing.mjs";

type Args = Record<string, unknown>;
type Result = Record<string, unknown>;
export type TypeLine = (args: Args & { text: string }) => Promise<Result>;

const BREAK = /\r\n|\r|\n/u;
const TRAILING_BREAKS = /(?:\r\n|\r|\n)+$/u;

/** The lines of `text` to type with a Shift+Return between each; a trailing run of line breaks stays on the last line,
 * typed as it came. Null when there is no line break inside the text. */
export function linesToType(text: string): string[] | null {
  const tail = TRAILING_BREAKS.exec(text)?.[0] ?? "";
  const lines = text.slice(0, text.length - tail.length).split(BREAK);
  if (lines.length < 2) return null;
  lines[lines.length - 1] += tail;
  return lines;
}

/** Whether a type_text call carries a line break before its last line. */
export function typesLineBreaks(name: string, args: unknown): args is Args & { text: string } {
  if (name !== "type_text" || !args || typeof args !== "object") return false;
  const { text } = args as Args;
  return typeof text === "string" && linesToType(withoutLeakedToolTags(text)) !== null;
}

/** Where the calls after the first go: the field the first one focused, never its element or point again, since
 * focusing those anew could move the caret. */
function sameField(args: Args): Args {
  const session = args.session === undefined ? {} : { session: args.session };
  if (args.scope === "desktop" && args.pid === undefined && args.window_id === undefined) return { scope: "desktop", ...session };
  return {
    ...(args.pid === undefined ? {} : { pid: args.pid }),
    ...(args.window_id !== undefined ? { window_id: args.window_id } : args.element_token !== undefined ? { element_token: args.element_token } : {}),
    ...(args.delivery_mode === undefined ? {} : { delivery_mode: args.delivery_mode }),
    ...session,
  };
}

/** The focusing part of a type_text call, for a press_key that has to come first. */
function withoutText(args: Args): Args {
  return Object.fromEntries(Object.entries(args).filter(([key]) => key !== "text"));
}

const failure = (text: string): Result => ({ content: [{ type: "text", text }], isError: true });

async function attempt(run: () => Promise<Result>): Promise<Result> {
  try {
    const result = await run();
    return result && typeof result === "object" ? result : failure("the computer gave no answer");
  } catch (error) {
    return failure(error instanceof Error ? error.message : String(error));
  }
}

/** Types `args.text` line by line through `typeLine`, with a Shift+Return through `call` between lines, so a chat box
 * gets the whole message as one draft and nothing is sent. Answers as the one call it was. */
export async function typeWithLineBreaks(
  call: (name: string, args: Args) => Promise<Result>,
  typeLine: TypeLine,
  args: Args & { text: string },
): Promise<Result> {
  const lines = linesToType(withoutLeakedToolTags(args.text));
  if (!lines) return attempt(() => typeLine(args));
  const later = sameField(args);
  let last: Result | undefined;
  let focused = false;
  for (const [index, line] of lines.entries()) {
    const steps: Array<() => Promise<Result>> = [];
    if (index > 0) {
      steps.push(() => call("press_key", { ...(focused ? later : withoutText(args)), key: "return", modifiers: ["shift"] }));
    }
    if (line) steps.push(() => typeLine({ ...(focused || index > 0 ? later : args), text: line }));
    for (const step of steps) {
      const result = await attempt(step);
      if (result.isError) {
        if (!last) return result;
        const content = Array.isArray(result.content) ? result.content : [];
        return { ...result, content: [{ type: "text", text:
          `Only ${index} of ${lines.length} lines went in (as one draft: line breaks are Shift+Return, so nothing was sent), then the next step failed. ` +
          "Read the field with get_window_state and add only what is missing; never type the whole text again. The failure:" }, ...content] };
      }
      last = result;
      focused = true;
    }
  }
  return { ...last, content: [{ type: "text", text: typedNote(lines, "Shift+Return") }] };
}

function typedNote(lines: readonly string[], chord: string): string {
  const sent = TRAILING_BREAKS.test(lines[lines.length - 1] ?? "")
    ? " The text ended with a line break, typed as Return, which sends in most chat apps: look at the conversation before sending anything again."
    : " Nothing was sent: check the field holds all of it, then send it once.";
  return `Typed ${lines.length} lines as one draft, each line break as ${chord}.${sent}`;
}

export interface EngineCall {
  name: string;
  arguments: Args;
  /** The line of the text this call begins or types. */
  line: number;
}

/** agent-browser calls for an agent_browser_type whose text has a line break inside it: each line typed into the same
 * field, with a Shift+Enter between, so a chat box keeps the whole message as one draft. Null for any other call. */
export function agentBrowserTypeInLines(name: string, args: unknown): { lines: string[]; calls: EngineCall[] } | null {
  if (name !== "agent_browser_type" || !args || typeof args !== "object") return null;
  const given = args as Args;
  if (typeof given.text !== "string") return null;
  const lines = linesToType(given.text);
  if (!lines) return null;
  const again = Object.fromEntries(Object.entries(given).filter(([key]) => key !== "clear"));
  const calls: EngineCall[] = [];
  let typed = false;
  for (const [index, line] of lines.entries()) {
    if (index > 0) calls.push({ name: "agent_browser_press", arguments: { key: "Shift+Enter" }, line: index });
    if (!line) continue;
    calls.push({ name: "agent_browser_type", arguments: { ...(typed ? again : given), text: line }, line: index });
    typed = true;
  }
  return { lines, calls };
}

const isFailure = (result: unknown) => !result || typeof result !== "object" || (result as Result).isError === true;

/** Runs the calls from agentBrowserTypeInLines in order through `run` and answers as the one call the bot made. */
export async function runAgentBrowserTypeInLines(
  { lines, calls }: { lines: readonly string[]; calls: readonly EngineCall[] },
  run: (call: EngineCall) => Promise<unknown>,
): Promise<unknown> {
  let last: unknown;
  for (const [index, call] of calls.entries()) {
    const result = await run(call);
    if (isFailure(result)) {
      if (index === 0) return result;
      const shown = result && typeof result === "object" ? result as Result : {};
      const content = Array.isArray(shown.content) ? shown.content : [];
      return { ...shown, isError: true, content: [{ type: "text", text:
        `Only ${call.line} of ${lines.length} lines went in (as one draft: line breaks are Shift+Enter, so nothing was sent), then the next step failed. ` +
        "Take a snapshot and add only what is missing; never type the whole text again. The failure:" }, ...content] };
    }
    last = result;
  }
  const shown = last as Result;
  const content = Array.isArray(shown.content) ? shown.content : [];
  return { ...shown, content: [{ type: "text", text: typedNote(lines, "Shift+Enter") }, ...content] };
}
