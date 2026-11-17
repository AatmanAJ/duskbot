/** What a person's demonstration is recorded on: the bot's browser, or its whole computer. */
export type DemoSurface = "browser" | "computer";

/**
 * Where the context of each action came from: the page's DOM, the operating system's accessibility tree, or neither.
 * With "none" only pictures and positions are kept, and nothing a person types is.
 */
export type DemoAccessibility = "dom" | "os" | "none";

/** A box in the picture's own pixels. */
export interface DemoRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DemoPoint {
  x: number;
  y: number;
}

/** The page or window an action happened in. */
export interface DemoContext {
  title?: string;
  url?: string;
  app?: string;
}

/** What accessibility says about the thing a person acted on. */
export interface DemoTarget {
  /** An ARIA role name: textbox, button, combobox, link, checkbox. */
  role: string;
  /** Its accessible name: the label a person reads. */
  name: string;
  bounds?: DemoRect;
  /** A password, code, card or account field. What is typed there is never kept, and it is blacked out of pictures. */
  secure: boolean;
  /** A drop-down list's options. */
  choices?: string[];
}

export type DemoEventKind = "open" | "click" | "double-click" | "right-click" | "type" | "choose" | "key" | "scroll" | "drag";

/** One thing the person did. */
export interface DemoEvent {
  seq: number;
  /** Milliseconds since the recording began. */
  at: number;
  kind: DemoEventKind;
  target?: DemoTarget;
  point?: DemoPoint;
  /** Where a drag ended. */
  to?: DemoPoint;
  /** What was typed or chosen. Never present with `secure`. */
  text?: string;
  /** Typed into a secure field, or where nothing could say the field was not one: only `chars` is kept. */
  secure?: true;
  chars?: number;
  /** A key that is not text: Enter, Tab, Escape, or a shortcut such as Control+S. */
  key?: string;
  url?: string;
  /** Which way a scroll went. */
  direction?: "up" | "down" | "left" | "right";
  context?: DemoContext;
  /** The picture before and after, by frame id. */
  before?: string;
  after?: string;
  /** Headings, notices and alerts that were not on screen before it. */
  appeared?: string[];
}

export interface DemoFrame {
  id: string;
  width: number;
  height: number;
  type: "image/png" | "image/jpeg";
  /** A secure field was blacked out of it. */
  masked: boolean;
  /** Picture pixels for each unit an event's point is measured in; 1 when unset. */
  scale?: number;
}

/** Everything recorded, before it is turned into steps. */
export interface DemoTrace {
  surface: DemoSurface;
  accessibility: DemoAccessibility;
  durationMs: number;
  events: DemoEvent[];
  frames: DemoFrame[];
  /** Pictures left out because a secure field on them could not be blacked out. */
  framesSkipped: number;
  /** The recording reached its limit and stopped taking events. */
  truncated: boolean;
}

export type DemoBlankKind = "text" | "number" | "date" | "choice" | "secret";

/** A named input of the task: what changes from one run to the next. Written {{name}} in goals, actions and checks. */
export interface DemoBlank {
  /** Lowercase letters, digits and underscores, starting with a letter. */
  name: string;
  /** The field's own label. */
  label: string;
  kind: DemoBlankKind;
  /** What the person entered when they showed it. Never present for a secret. */
  example?: string;
  choices?: string[];
}

/** One way to carry a step out by accessibility, without the model: found by role and name, never by position. */
export type DemoAction =
  | { do: "open"; url: string }
  | { do: "click"; role: string; name: string }
  | { do: "fill"; role: string; name: string; value: string }
  | { do: "choose"; role: string; name: string; value: string }
  | { do: "press"; key: string };

/**
 * How a step is known to have worked. In `text`, `title`, `url` and `value`, {{name}} stands for a blank and * for
 * anything; the rest must appear, ignoring case and spacing.
 */
export type DemoCheck =
  | { kind: "text"; text: string }
  | { kind: "field"; role: string; name: string; value: string }
  | { kind: "title"; text: string }
  | { kind: "url"; text: string }
  | { kind: "visual"; expect: string };

export interface DemoStep {
  id: string;
  title: string;
  /** What to get done, in words, with {{blanks}}. */
  goal: string;
  actions: DemoAction[];
  check: DemoCheck;
  /** The picture from just before it: where to act. */
  frame?: string;
  /** The picture from just after it: what it should lead to. */
  frameAfter?: string;
  /** Where the person pressed in that picture, when accessibility named nothing. */
  point?: DemoPoint;
  /** The recorded events it came from, by seq. */
  events: number[];
}

/** A demonstration as steps: what gets saved as a skill and replayed. */
export interface DemoPlan {
  title: string;
  summary: string;
  blanks: DemoBlank[];
  steps: DemoStep[];
  /** "engine": the bot's model wrote the steps. "outline": written from the recording alone, one step for each action. */
  compiledBy: "engine" | "outline";
}

export type DemoRecordingStatus = "recording" | "compiling" | "ready" | "failed";

export interface DemoRecording {
  id: string;
  botId: string;
  threadId?: string;
  surface: DemoSurface;
  accessibility: DemoAccessibility;
  status: DemoRecordingStatus;
  createdAt: number;
  durationMs: number;
  eventCount: number;
  frames: DemoFrame[];
  framesSkipped: number;
  plan?: DemoPlan;
  /** The skill it was saved as. */
  skillName?: string;
  routineId?: string;
  error?: string;
}

/** One set of values for a plan's blanks: a file, or a row of a table. */
export interface DemoReplayItem {
  id: string;
  label: string;
  values: Record<string, string>;
  /** Blanks no value was found for. */
  missing: string[];
}

export type DemoStepOutcome = {
  id: string;
  title: string;
  status: "done" | "failed" | "not-run";
  /** "direct": carried out by accessibility. "bot": the bot's own computer use did it. */
  via?: "direct" | "bot";
  attempts: number;
  note?: string;
};

export interface DemoItemOutcome {
  id: string;
  label: string;
  status: "done" | "failed" | "skipped";
  steps: DemoStepOutcome[];
}

export interface DemoReplayReport {
  items: DemoItemOutcome[];
  done: number;
  failed: number;
}

export type DemoReplayProgress =
  | { type: "item-start"; item: string; index: number; total: number }
  | { type: "step-start"; item: string; step: string }
  | { type: "step-done"; item: string; step: string; ok: boolean; via: "direct" | "bot"; attempts: number; note?: string }
  | { type: "item-done"; item: string; ok: boolean };
