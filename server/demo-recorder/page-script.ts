import type { DemoStepKind, DemoTarget } from "../../shared/demo-recording.ts";

/** Installs the recorder in a document once; evaluating it again changes nothing. */
export const DEMO_PAGE_SCRIPT = "";

/** The attribute a found element carries while the replayer acts on it. */
export const DEMO_MARK = "data-dusk-demo";

/** Answers a `DemoDrain` as JSON: what the person did since the last read. `installed` is false where the script is absent. */
export function demoDrainExpression(): string {
  throw new Error("not built");
}

/** What `demoFindExpression` answers, as JSON. */
export interface DemoFound {
  /** How many elements the words name: the step acts only when it is exactly one. */
  count: number;
  /** The CSS selector of the one element found, good until `demoUnmarkExpression`. */
  selector?: string;
  tag?: string;
  inputType?: string;
  disabled?: boolean;
  checked?: boolean;
  /** The page keeps this field private: nothing is typed into it but a saved login. */
  sensitive?: boolean;
  /** For a list or a group of options: whether the wanted option is there. */
  option?: boolean;
}

/** Finds the one element a step's target names and marks it with `nonce`. */
export function demoFindExpression(_target: DemoTarget, _options: { kind: DemoStepKind; nonce: string; value?: string }): string {
  throw new Error("not built");
}

export type DemoPageAction =
  | { do: "focus" }
  | { do: "set"; value: string }
  | { do: "select"; value: string }
  | { do: "read" };

/** Acts on the element `nonce` marks, in the page: focus and select a field, set a value typing cannot, choose an option, read back. */
export function demoActExpression(_nonce: string, _action: DemoPageAction): string {
  throw new Error("not built");
}

/** Takes the marks of `nonce` off the page. */
export function demoUnmarkExpression(_nonce: string): string {
  throw new Error("not built");
}

/** What `demoPageStateExpression` answers, as JSON. */
export interface DemoPageState {
  url: string;
  title: string;
  /** The document has finished loading. */
  ready: boolean;
  /** A password box a person could type into is showing. */
  passwordField: boolean;
}

export function demoPageStateExpression(): string {
  throw new Error("not built");
}
