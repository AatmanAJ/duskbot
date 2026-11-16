import type { DemoTarget } from "../../shared/demo-recording.ts";

/** An element as the page script reports it: the words of a `DemoTarget`, plus what the cleanup needs to know. */
export interface RawDemoTarget extends DemoTarget {
  tag: string;
  inputType?: string;
  /** The same number for every field of one form in one document. */
  form?: number;
  /** The page keeps this field's value private; the script never reads it. */
  sensitive?: boolean;
  /** A control or a link, or something inside one: a click here does something. */
  interactive?: boolean;
  /** Text can be typed into it. */
  editable?: boolean;
}

export const RAW_DEMO_EVENT_TYPES = ["open", "click", "input", "change", "key", "submit", "focus", "blur", "scroll"] as const;
export type RawDemoEventType = (typeof RAW_DEMO_EVENT_TYPES)[number];

/** One thing the page saw the person do. It never carries a point on screen, and never a sensitive field's value. */
export interface RawDemoEvent {
  at: number;
  type: RawDemoEventType;
  /** The address of the document the event happened in. */
  url: string;
  target?: RawDemoTarget;
  value?: string;
  checked?: boolean;
  key?: string;
  /** The label of the option a list now shows. */
  option?: string;
  /** The names of the files a file picker was given, never their paths. */
  files?: string[];
}

/** What one read of the page answers. */
export interface DemoDrain {
  installed: boolean;
  url: string;
  title: string;
  events: RawDemoEvent[];
}
