import type { DemoAccessibility, DemoContext, DemoEvent, DemoPoint, DemoRect, DemoSeeing, DemoSurface, DemoTarget, DemoTrace } from "../../shared/demo-recording.ts";
import type { FrameStore, ScreenFrame } from "./frames.ts";

/** Modifier bits as the Chrome DevTools protocol numbers them. */
export const MODIFIER = { alt: 1, ctrl: 2, meta: 4, shift: 8 } as const;

export type RawInput =
  | { type: "pointer"; action: "down" | "up" | "move"; x: number; y: number; button?: "left" | "middle" | "right"; clickCount?: number }
  | { type: "wheel"; x: number; y: number; deltaX: number; deltaY: number }
  | { type: "key"; action: "down" | "up"; key: string; text?: string; modifiers?: number }
  | { type: "text"; text: string }
  | { type: "open"; url: string }
  | { type: "choose"; x: number; y: number; label: string };

/** What can be asked about the screen while a person works on it. */
export interface AccessibilityProbe {
  readonly kind: DemoAccessibility;
  at(point: DemoPoint): Promise<DemoTarget | null>;
  focused(): Promise<DemoTarget | null>;
  /** Every secure field on screen now; null when that cannot be told. */
  secureRegions(): Promise<DemoRect[] | null>;
  context(): Promise<DemoContext>;
  /** Headings, notices and alerts on screen now. */
  texts?(): Promise<string[]>;
}

export interface ScreenSource {
  frame(): Promise<ScreenFrame | null>;
}

export interface CaptureLimits {
  maxEvents: number;
  maxDurationMs: number;
  /** A press and release further apart than this many pixels is a drag. */
  dragDistance: number;
}

export const CAPTURE_LIMITS: CaptureLimits = { maxEvents: 400, maxDurationMs: 20 * 60_000, dragDistance: 12 };

export interface CaptureDeps {
  surface: DemoSurface;
  probe: AccessibilityProbe;
  screen: ScreenSource;
  frames: FrameStore;
  now?: () => number;
  /** Takes known secrets out of text that is kept: saved passwords and the shapes of keys and tokens. */
  scrub?: (text: string) => string;
  log?: (line: string) => void;
  limits?: Partial<CaptureLimits>;
}

export interface DemoCapture {
  /**
   * One thing the person did, given before it reaches the screen. Security: what is typed is kept only when
   * accessibility says, before the next click or key that could move focus, that the field is not a secure one.
   */
  input(raw: RawInput): Promise<void>;
  /**
   * The same, for a caller that passes the input on to the screen afterwards: it calls what this answers once the
   * input has landed there. Security: a look at the focused field waits for the click or key before it to land, so a
   * key typed right after a Tab is never placed in the field the Tab left.
   */
  relay(raw: RawInput): Promise<() => void>;
  finish(): Promise<DemoTrace>;
  /** Takes back the last thing written down. False when there was nothing to take back. */
  undo(): Promise<boolean>;
  readonly eventCount: number;
  /** Security: the last thing the person did as its kind, its target's label and a count, never the text. */
  readonly seeing: DemoSeeing | null;
}

/** A desktop's accessibility is read over a slow path, so one look serves a run of keys for this long. */
const OS_LOOK_MS = 750;
/** How long a relayed input may take to reach the screen before what is typed after it stops being kept. */
const LANDING_MS = 3_000;
const DOUBLE_CLICK_MS = 500;
const DOUBLE_CLICK_PIXELS = 6;
const TEXT_LIMIT = 10_000;
const NAME_LIMIT = 300;
const APPEARED_LIMIT = 12;
const MODIFIER_KEYS = new Set(["Shift", "Control", "Alt", "Meta", "AltGraph", "CapsLock", "NumLock", "ScrollLock", "Fn", "OS", "Super", "Hyper"]);

/** Whether an input can move focus: what is typed before it cannot be placed by a look that finished after it came. */
function movesFocus(raw: RawInput): boolean {
  if (raw.type === "pointer") return raw.action === "down";
  if (raw.type === "open" || raw.type === "choose") return true;
  if (raw.type !== "key" || raw.action !== "down") return false;
  return typedText(raw) === null && raw.key !== "Backspace" && !MODIFIER_KEYS.has(raw.key);
}

const isControl = (char: string) => char.charCodeAt(0) < 0x20 || char.charCodeAt(0) === 0x7f;

/** The characters a key press writes, or null for a key that writes none. */
function typedText(raw: Extract<RawInput, { type: "key" }>): string | null {
  const bits = raw.modifiers ?? 0;
  const alt = (bits & MODIFIER.alt) !== 0;
  const ctrl = (bits & MODIFIER.ctrl) !== 0;
  // Security: Option on a Mac and AltGr elsewhere (Control with Alt) write characters, so those are typing, never a named key.
  if (bits & MODIFIER.meta || (ctrl && !alt)) return null;
  if (typeof raw.text === "string" && raw.text.length > 0 && ![...raw.text].some(isControl)) return raw.text;
  if (alt && !ctrl) return null;
  return [...raw.key].length === 1 && raw.text === undefined ? raw.key : null;
}

function keyName(raw: Extract<RawInput, { type: "key" }>): string {
  const bits = raw.modifiers ?? 0;
  const key = [...raw.key].length === 1 ? raw.key.toUpperCase() : raw.key;
  return [bits & MODIFIER.ctrl ? "Control" : "", bits & MODIFIER.alt ? "Alt" : "", bits & MODIFIER.shift ? "Shift" : "", bits & MODIFIER.meta ? "Meta" : "", key].filter(Boolean).join("+");
}

function sameTarget(a: DemoTarget | null, b: DemoTarget | null): boolean {
  if (!a || !b) return a === b;
  return a.role === b.role && a.name === b.name && a.secure === b.secure && a.bounds?.x === b.bounds?.x && a.bounds?.y === b.bounds?.y;
}

interface Run {
  event: DemoEvent;
  target: DemoTarget | null;
  /** Null once the run may not be kept: only its length is. */
  text: string | null;
  chars: number;
  lookedAt: number;
}

interface Press {
  event: DemoEvent;
  down: DemoPoint;
  button: "left" | "middle" | "right";
}

interface Scroll {
  event: DemoEvent;
  dx: number;
  dy: number;
}

export function createDemoCapture(deps: CaptureDeps): DemoCapture {
  const { probe, screen, frames } = deps;
  const now = deps.now ?? Date.now;
  const scrub = deps.scrub ?? ((text: string) => text);
  const limits: CaptureLimits = { ...CAPTURE_LIMITS, ...deps.limits };
  const startedAt = now();
  const events: DemoEvent[] = [];
  const beforeTexts = new WeakMap<DemoEvent, string[]>();
  const used = new Set<string>();

  let chain: Promise<void> = Promise.resolve();
  let landing: Promise<boolean> = Promise.resolve(true);
  let arrived = 0;
  let lastFocusMove = 0;
  let run: Run | null = null;
  let press: Press | null = null;
  let scroll: Scroll | null = null;
  let awaitingAfter: DemoEvent | null = null;
  let lastClick: { event: DemoEvent; point: DemoPoint; at: number } | null = null;
  let truncated = false;
  let finished: DemoTrace | null = null;
  let endedAt = startedAt;

  const clean = (target: DemoTarget | null): DemoTarget | null => target && {
    role: String(target.role).slice(0, 60),
    name: scrub(String(target.name)).slice(0, NAME_LIMIT),
    secure: target.secure === true,
    ...(target.bounds ? { bounds: target.bounds } : {}),
    ...(target.choices ? { choices: target.choices.slice(0, 200).map((choice) => String(choice).slice(0, NAME_LIMIT)) } : {}),
  };
  const targetAt = async (point: DemoPoint) => (probe.kind === "none" ? null : clean(await probe.at(point).catch(() => null)));
  const contextNow = async (): Promise<DemoContext> => {
    const context = await probe.context().catch((): DemoContext => ({}));
    return { ...(context.title ? { title: scrub(context.title).slice(0, NAME_LIMIT) } : {}), ...(context.url ? { url: context.url.slice(0, 2_000) } : {}), ...(context.app ? { app: context.app.slice(0, NAME_LIMIT) } : {}) };
  };
  const textsNow = async (): Promise<string[]> => {
    if (!probe.texts) return [];
    const texts = await probe.texts().catch((): string[] => []);
    return texts.filter((text) => typeof text === "string" && text.trim().length > 0).map((text) => scrub(text.trim()).slice(0, 400));
  };

  /** The picture at the line between two events: after the one that just ended and before the one beginning. */
  async function boundary(): Promise<{ frame: string | undefined; texts: string[] }> {
    const first = await probe.secureRegions().catch(() => null);
    const shot = await screen.frame().catch(() => null);
    const second = shot ? await probe.secureRegions().catch(() => null) : first;
    const secure = first === null || second === null ? null : [...first, ...second];
    const kept = shot ? await frames.put(shot, secure, probe.kind).catch(() => null) : null;
    if (kept) used.add(kept.id);
    const texts = await textsNow();
    const ended = awaitingAfter;
    awaitingAfter = null;
    if (ended) {
      if (kept) ended.after = kept.id;
      const before = new Set(beforeTexts.get(ended) ?? []);
      const appeared = texts.filter((text) => !before.has(text)).slice(0, APPEARED_LIMIT);
      if (appeared.length) ended.appeared = appeared;
    }
    return { frame: kept?.id, texts };
  }

  function full(): boolean {
    if (truncated) return true;
    const pending = (run ? 1 : 0) + (press ? 1 : 0) + (scroll ? 1 : 0);
    if (events.length + pending >= limits.maxEvents || now() - startedAt > limits.maxDurationMs) truncated = true;
    return truncated;
  }

  /** Starts an event: its picture, where it happened and when. Null once the recording is full. */
  async function begin(kind: DemoEvent["kind"]): Promise<DemoEvent | null> {
    if (full()) return null;
    const at = Math.max(0, now() - startedAt);
    const { frame, texts } = await boundary();
    const context = await contextNow();
    const event: DemoEvent = { seq: 0, at, kind, ...(Object.keys(context).length ? { context } : {}), ...(frame ? { before: frame } : {}) };
    beforeTexts.set(event, texts);
    return event;
  }

  function emit(event: DemoEvent): void {
    event.seq = events.length + 1;
    events.push(event);
    awaitingAfter = event;
    endedAt = now();
  }

  function endRun(): void {
    const ending = run;
    run = null;
    if (!ending || ending.chars === 0) return;
    const { event } = ending;
    if (ending.text !== null && ending.target && !ending.target.secure) {
      event.target = ending.target;
      event.text = scrub(ending.text).slice(0, TEXT_LIMIT);
    } else {
      if (ending.target?.secure) event.target = ending.target;
      event.secure = true;
      event.chars = ending.chars;
    }
    emit(event);
  }

  function endScroll(): void {
    const ending = scroll;
    scroll = null;
    if (!ending) return;
    const { event, dx, dy } = ending;
    event.direction = Math.abs(dy) >= Math.abs(dx) ? (dy >= 0 ? "down" : "up") : dx >= 0 ? "right" : "left";
    emit(event);
  }

  function endPress(up: DemoPoint | null): void {
    const ending = press;
    press = null;
    if (!ending) return;
    const { event, down, button } = ending;
    if (up && Math.hypot(up.x - down.x, up.y - down.y) > limits.dragDistance) {
      event.kind = "drag";
      event.to = up;
    } else if (button === "right") event.kind = "right-click";
    emit(event);
    lastClick = event.kind === "click" ? { event, point: down, at: now() } : null;
  }

  function settle(): void {
    endRun();
    endScroll();
    endPress(null);
  }

  /** Whether an input that can move focus has come since `order`: a look that finished after it says nothing about before it. */
  const focusMovedSince = (order: number) => lastFocusMove > order;

  async function typed(text: string, order: number, landed: Promise<boolean>): Promise<void> {
    const chars = [...text].length;
    if (!chars) return;
    if (run && run.text === null) {
      run.chars += chars;
      return;
    }
    const mustLook = probe.kind === "dom" || !run || now() - run.lookedAt >= OS_LOOK_MS;
    let target = run?.target ?? null;
    let certain = probe.kind !== "none";
    if (probe.kind !== "none" && mustLook) {
      if (!await landed) certain = false;
      try {
        target = clean(await probe.focused());
      } catch {
        target = null;
        certain = false;
      }
      if (focusMovedSince(order)) certain = false;
    }
    if (run && certain && probe.kind === "dom" && !sameTarget(run.target, target)) endRun();
    if (!run) {
      endScroll();
      endPress(null);
      const event = await begin("type");
      if (!event) return;
      run = { event, target, text: "", chars: 0, lookedAt: now() };
    } else if (mustLook) {
      if (!sameTarget(run.target, target)) certain = false;
      run.lookedAt = now();
    }
    const keep = certain && target !== null && !target.secure;
    if (!keep) {
      run.text = null;
      if (target?.secure) run.target = target;
    } else if (run.text !== null) run.text = (run.text + text).slice(0, TEXT_LIMIT);
    run.chars += chars;
  }

  async function handle(raw: RawInput, order: number, landed: Promise<boolean>): Promise<void> {
    if (finished) return;
    if (raw.type === "pointer") {
      const point = { x: raw.x, y: raw.y };
      if (raw.action === "move") return;
      if (raw.action === "up") {
        if (press) endPress(point);
        return;
      }
      settle();
      const again = raw.clickCount !== undefined ? raw.clickCount >= 2 : lastClick !== null && now() - lastClick.at <= DOUBLE_CLICK_MS;
      if (again && lastClick && lastClick.event === events.at(-1) && Math.hypot(point.x - lastClick.point.x, point.y - lastClick.point.y) <= DOUBLE_CLICK_PIXELS && (raw.button ?? "left") === "left") {
        lastClick.event.kind = "double-click";
        lastClick = null;
        return;
      }
      const event = await begin("click");
      if (!event) return;
      event.point = point;
      const target = await targetAt(point);
      if (target) event.target = target;
      press = { event, down: point, button: raw.button ?? "left" };
      return;
    }
    if (raw.type === "wheel") {
      if (!scroll) {
        endRun();
        endPress(null);
        const event = await begin("scroll");
        if (!event) return;
        event.point = { x: raw.x, y: raw.y };
        scroll = { event, dx: 0, dy: 0 };
      }
      scroll.dx += raw.deltaX;
      scroll.dy += raw.deltaY;
      return;
    }
    if (raw.type === "text") {
      await typed(raw.text, order, landed);
      return;
    }
    if (raw.type === "key") {
      if (raw.action === "up" || MODIFIER_KEYS.has(raw.key)) return;
      const text = typedText(raw);
      if (text !== null) {
        await typed(text, order, landed);
        return;
      }
      if (raw.key === "Backspace" && !raw.modifiers && run) {
        run.chars = Math.max(0, run.chars - 1);
        if (run.text !== null) run.text = [...run.text].slice(0, -1).join("");
        return;
      }
      settle();
      const event = await begin("key");
      if (!event) return;
      event.key = keyName(raw);
      emit(event);
      return;
    }
    settle();
    if (raw.type === "open") {
      const event = await begin("open");
      if (!event) return;
      event.url = raw.url.slice(0, 2_000);
      emit(event);
      return;
    }
    const event = await begin("choose");
    if (!event) return;
    event.point = { x: raw.x, y: raw.y };
    const target = await targetAt(event.point);
    if (target) event.target = target;
    event.text = scrub(raw.label).slice(0, NAME_LIMIT);
    emit(event);
  }

  function record(raw: RawInput): Promise<void> {
    const order = ++arrived;
    const landed = landing;
    if (movesFocus(raw)) lastFocusMove = order;
    chain = chain.then(() => handle(raw, order, landed)).catch(() => {
      deps.log?.("demo capture: an input could not be recorded");
    });
    return chain;
  }

  return {
    input: record,
    async relay(raw) {
      if (!movesFocus(raw)) {
        await record(raw);
        return () => {};
      }
      let land: (reached: boolean) => void = () => {};
      const recorded = record(raw);
      landing = new Promise<boolean>((resolve) => { land = resolve; });
      await recorded;
      const late = setTimeout(() => land(false), LANDING_MS);
      return () => {
        clearTimeout(late);
        land(true);
      };
    },
    async finish() {
      await chain;
      if (finished) return finished;
      settle();
      if (awaitingAfter) await boundary().catch(() => {});
      const kept = frames.list().filter((frame) => used.has(frame.id));
      finished = {
        surface: deps.surface,
        accessibility: probe.kind,
        durationMs: Math.max(0, endedAt - startedAt),
        events,
        frames: kept,
        framesSkipped: frames.skipped,
        truncated,
      };
      deps.log?.(`demo capture: ${events.length} events, ${kept.length} pictures, ${frames.skipped} left out`);
      return finished;
    },
    undo() {
      const taken = chain.then(() => {
        settle();
        const gone = events.pop();
        awaitingAfter = null;
        lastClick = null;
        return gone !== undefined;
      });
      chain = taken.then(() => {}, () => {});
      return taken.catch(() => false);
    },
    get eventCount() {
      return events.length;
    },
    get seeing() {
      if (run) return { kind: "type" as const, ...(run.target ? { name: run.target.name } : {}), ...(run.text === null || run.target?.secure ? { secure: true as const } : {}), chars: run.chars };
      const last = events.at(-1);
      if (!last) return null;
      return { kind: last.kind, ...(last.target ? { name: last.target.name } : {}), ...(last.secure ? { secure: true as const } : {}), ...(last.chars !== undefined ? { chars: last.chars } : last.text !== undefined ? { chars: [...last.text].length } : {}) };
    },
  };
}
