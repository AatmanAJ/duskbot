import type { DemoStep } from "../../shared/demo-recording.ts";
import type { RawDemoEvent } from "./events.ts";

/** What the person meant: one step per thing done, without stray clicks, scrolling, retyping or focus moving about. */
export function normaliseDemo(_events: readonly RawDemoEvent[]): DemoStep[] {
  throw new Error("not built");
}
