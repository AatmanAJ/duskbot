import { redactSecretsInText } from "../../shared/redact.ts";
import { TEACH_LIMITS, type TaughtStep, type TaughtTarget, type TeachStatus, type TeachStopReason } from "../../shared/teach-task.ts";
import { isSensitiveInput } from "./cdp/sensitive.ts";

export type TeachInput =
  | { kind: "press"; x: number; y: number }
  | { kind: "text"; text: string; secret?: true }
  | { kind: "key"; key: string }
  | { kind: "open"; url: string }
  | { kind: "choose"; option: string };

/** Runs a fixed script in the page in front and resolves to its value. */
export type Evaluate = (script: string) => Promise<unknown>;

const KEPT_MS = 30 * 60_000;
const NAME_MAX = 80;
const KEYS = new Set(["Enter", "Tab", "Escape"]);

// Security: only names, roles, field hints, the address and the title leave the page; never a field's value.
const describeScript = (point: { x: number; y: number } | null) => `(() => {
  const point = ${JSON.stringify(point)};
  let element = point ? document.elementFromPoint(point.x, point.y) : document.activeElement;
  while (point && element && element.shadowRoot) {
    const inner = element.shadowRoot.elementFromPoint(point.x, point.y);
    if (!inner || inner === element) break;
    element = inner;
  }
  const clip = (value) => String(value || "").replace(/\\s+/g, " ").trim().slice(0, ${NAME_MAX});
  const where = { url: String(location.href), title: clip(document.title) };
  const hit = element && element.closest ? element.closest("a[href],button,input,select,textarea,summary,label,[role],[contenteditable='true'],[contenteditable='']") || element : null;
  if (!hit || hit === document.body || hit === document.documentElement) return { ...where, target: null };
  const tag = hit.tagName.toLowerCase();
  const type = tag === "input" ? String(hit.type || "text").toLowerCase() : "";
  const inputRoles = { checkbox: "checkbox", radio: "radio", search: "searchbox", button: "button", submit: "button", reset: "button", range: "slider" };
  const role = hit.getAttribute("role") || (tag === "a" ? "link" : tag === "button" || tag === "summary" ? "button" : tag === "select" ? "combobox"
    : tag === "textarea" || hit.isContentEditable ? "textbox" : tag === "input" ? inputRoles[type] || "textbox" : /^h[1-6]$/.test(tag) ? "heading" : tag === "img" ? "image" : tag);
  const labelled = (hit.getAttribute("aria-labelledby") || "").split(/\\s+/).map((id) => id && document.getElementById(id)).filter(Boolean).map((node) => node.innerText).join(" ");
  const label = hit.labels && hit.labels[0] ? hit.labels[0].innerText : "";
  const field = (tag === "input" && !["button", "submit", "reset"].includes(type)) || tag === "textarea" || tag === "select" || hit.isContentEditable;
  const shown = field ? "" : tag === "input" ? hit.value : hit.innerText;
  const name = clip(hit.getAttribute("aria-label") || labelled || label || hit.getAttribute("placeholder") || hit.getAttribute("title") || hit.getAttribute("alt") || shown);
  const hints = [hit.getAttribute("autocomplete"), hit.getAttribute("name"), hit.id, hit.getAttribute("placeholder"), hit.getAttribute("aria-label"), label].map(clip);
  return { ...where, target: { role: clip(role), name, type, hints } };
})()`;

interface Described { url: string; title: string; target: (TaughtTarget & { sensitive: boolean }) | null }

const text = (value: unknown, max: number) => (typeof value === "string" ? value.slice(0, max) : "");

function described(value: unknown): Described | null {
  if (!value || typeof value !== "object") return null;
  const found = value as Record<string, unknown>;
  const target = found.target && typeof found.target === "object" ? found.target as Record<string, unknown> : null;
  const hints = Array.isArray(target?.hints) ? target.hints.map((hint) => text(hint, NAME_MAX)) : [];
  return {
    url: text(found.url, 4096),
    title: redactSecretsInText(text(found.title, NAME_MAX)),
    target: target ? {
      role: text(target.role, 40) || "element",
      name: redactSecretsInText(text(target.name, NAME_MAX)),
      sensitive: isSensitiveInput(text(target.type, 40), hints),
    } : null,
  };
}

/** Origin and path only: a query or fragment can carry a sign-in code or a token. */
export function taughtUrl(value: string): string {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    return redactSecretsInText(`${url.origin}${url.pathname}`);
  } catch { return ""; }
}

const isShortcut = (modifiers: unknown) => typeof modifiers === "number" && (modifiers & 0b111) !== 0;

function keyInput(key: unknown, typed: unknown, modifiers: unknown): TeachInput | null {
  if (isShortcut(modifiers) || typeof key !== "string") return null;
  if (key === "Enter" || typed === "\r") return { kind: "key", key: "Enter" };
  if (typeof typed === "string" && [...typed].length === 1 && typed >= " ") return { kind: "text", text: typed };
  if (key === "Backspace" || KEYS.has(key)) return { kind: "key", key };
  return null;
}

/** What a v2 viewer message (the new engine) shows of the task, if anything. */
export function teachInputOf(message: Record<string, unknown>): TeachInput | null {
  if (message.type === "mouse") {
    const single = typeof message.clickCount !== "number" || message.clickCount <= 1;
    return message.action === "down" && message.button === "left" && single ? { kind: "press", x: Number(message.x), y: Number(message.y) } : null;
  }
  if (message.type === "key") return message.action === "down" ? keyInput(message.key, message.text, message.modifiers) : null;
  if (message.type === "text") return typeof message.text === "string" && message.text ? { kind: "text", text: message.text, ...(message.secret === true ? { secret: true as const } : {}) } : null;
  if (message.type === "navigate") return typeof message.url === "string" ? { kind: "open", url: message.url } : null;
  if (message.type === "history") return { kind: "key", key: Number(message.delta) < 0 ? "the browser's Back button" : "the browser's Forward button" };
  if (message.type === "reload") return { kind: "key", key: "the browser's Reload button" };
  return null;
}

/** The same, for a v1 view's input (agent-browser) or toolbar command. */
export function teachInputOfV1(message: Record<string, unknown>): TeachInput | null {
  if (message.type === "input_mouse") {
    return teachInputOf({ type: "mouse", action: message.eventType === "mousePressed" ? "down" : "", button: message.button, clickCount: message.clickCount, x: message.x, y: message.y });
  }
  if (message.type !== "input_keyboard") return null;
  if (message.eventType === "char") return teachInputOf({ type: "text", text: message.text, secret: message.secret });
  return message.eventType === "keyDown" ? keyInput(message.key, message.text, message.modifiers) : null;
}

export function teachCommandOfV1(args: readonly string[]): TeachInput | null {
  const [verb, url] = args;
  if (verb === "open" && url) return { kind: "open", url };
  if (verb === "back" || verb === "forward" || verb === "reload") return teachInputOf({ type: verb === "reload" ? "reload" : "history", delta: verb === "back" ? -1 : 1 });
  return null;
}

class Recording {
  readonly steps: TaughtStep[] = [];
  stopped?: TeachStopReason;
  stoppedAt = 0;
  #url = "";
  #typing: Extract<TaughtStep, { kind: "type" }> | null = null;
  #turn: Promise<void> = Promise.resolve();
  readonly person: string;
  readonly startedAt: number;
  constructor(person: string, startedAt: number) { this.person = person; this.startedAt = startedAt; }

  status(): TeachStatus {
    return {
      recording: !this.stopped, startedAt: this.startedAt,
      steps: this.steps.map((step) => (step.kind === "type" ? { ...step, text: redactSecretsInText(step.text) } : { ...step })),
      ...(this.stopped ? { stopped: this.stopped } : { endsAt: this.startedAt + TEACH_LIMITS.ms }),
    };
  }

  stop(reason: TeachStopReason, now: number): void {
    if (this.stopped) return;
    this.stopped = reason;
    this.stoppedAt = now;
  }

  /** Settles once every input noted so far is recorded. */
  settled(): Promise<void> { return this.#turn; }

  note(input: TeachInput, evaluate: Evaluate, now: number): Promise<void> {
    const turn = this.#turn.then(() => this.#note(input, evaluate, now));
    this.#turn = turn.catch(() => undefined);
    return turn;
  }

  async #note(input: TeachInput, evaluate: Evaluate, now: number): Promise<void> {
    if (this.stopped) return;
    if (now >= this.startedAt + TEACH_LIMITS.ms) return this.stop("time", now);
    const typing = this.#typing;
    if (input.kind === "text" && typing && !input.secret) {
      if (!typing.hidden) typing.text = (typing.text + input.text).slice(0, TEACH_LIMITS.typed);
      return;
    }
    if (input.kind === "key" && input.key === "Backspace") {
      if (typing && !typing.hidden) typing.text = typing.text.slice(0, -1);
      return;
    }
    this.#typing = null;
    if (input.kind === "open") {
      const url = taughtUrl(input.url);
      if (url) this.#page(url, "");
    } else if (input.kind === "press" || input.kind === "text") {
      const found = described(await evaluate(describeScript(input.kind === "press" ? { x: input.x, y: input.y } : null)).catch(() => null));
      if (found) this.#page(taughtUrl(found.url), found.title);
      const target = found?.target ? { role: found.target.role, name: found.target.name } : null;
      if (input.kind === "press") this.#push({ kind: "click", target });
      else {
        const step: Extract<TaughtStep, { kind: "type" }> = !found?.target || found.target.sensitive || input.secret
          ? { kind: "type", target, text: "", hidden: true }
          : { kind: "type", target, text: input.text.slice(0, TEACH_LIMITS.typed) };
        this.#push(step);
        this.#typing = step;
      }
    } else if (input.kind === "choose") this.#push({ kind: "choose", option: redactSecretsInText(input.option.slice(0, NAME_MAX)) });
    else this.#push({ kind: "key", key: input.key });
    if (this.steps.length >= TEACH_LIMITS.steps) this.stop("steps", now);
  }

  #page(url: string, title: string): void {
    if (!url || url === this.#url) return;
    this.#url = url;
    if (this.steps.at(-1)?.kind === "page") this.steps.pop();
    this.#push({ kind: "page", url, title });
  }

  #push(step: TaughtStep): void {
    if (this.steps.length < TEACH_LIMITS.steps) this.steps.push(step);
  }
}

export class TeachError extends Error {
  readonly status: number;
  constructor(message: string, status = 409) { super(message); this.name = "TeachError"; this.status = status; }
}

/** One recording per browser session, owned by the person who started it; only that person's input is recorded. */
export class TeachRecorders {
  readonly #recordings = new Map<string, Recording>();
  readonly #now: () => number;
  constructor(now: () => number = Date.now) { this.#now = now; }

  #current(session: string): Recording | undefined {
    const recording = this.#recordings.get(session);
    if (!recording) return undefined;
    const now = this.#now();
    if (!recording.stopped && now >= recording.startedAt + TEACH_LIMITS.ms) recording.stop("time", now);
    if (recording.stopped && now - recording.stoppedAt > KEPT_MS) {
      this.#recordings.delete(session);
      return undefined;
    }
    return recording;
  }

  #own(session: string, person: string): Recording | undefined {
    const recording = this.#current(session);
    return recording?.person === person ? recording : undefined;
  }

  start(session: string, person: string): TeachStatus {
    const other = this.#current(session);
    if (other && other.person !== person && !other.stopped) throw new TeachError("Someone else is recording a task in this browser.");
    const recording = new Recording(person, this.#now());
    this.#recordings.set(session, recording);
    return recording.status();
  }

  stop(session: string, person: string): TeachStatus {
    const recording = this.#own(session, person);
    if (!recording) throw new TeachError("There is no recording to stop.", 404);
    recording.stop("person", this.#now());
    return recording.status();
  }

  discard(session: string, person: string): void {
    if (this.#own(session, person)) this.#recordings.delete(session);
  }

  status(session: string, person: string): TeachStatus {
    return this.#own(session, person)?.status() ?? { recording: false, steps: [] };
  }

  /** Whether this person's input in this browser is being recorded now. */
  recording(session: string, person: string): boolean {
    const recording = this.#own(session, person);
    return Boolean(recording && !recording.stopped);
  }

  /** Records one input of the person's, before the browser takes it, while they record in this browser. An input that
   * shows nothing of the task (a release, a move) still waits for the ones before it, so none overtakes another. */
  note(session: string, person: string, input: TeachInput | null, evaluate: Evaluate): Promise<void> {
    const recording = this.#own(session, person);
    if (!recording || recording.stopped) return Promise.resolve();
    return input ? recording.note(input, evaluate, this.#now()) : recording.settled();
  }
}
