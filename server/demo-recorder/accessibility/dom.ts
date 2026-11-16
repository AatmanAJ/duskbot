import type { AccessibilityProbe } from "../capture.ts";
import type { ReplaySurface } from "../replay.ts";

const todo = (): never => { throw new Error("not built"); };

/** Runs an expression in the page, out of reach of the page's own scripts, and returns its JSON value. */
export type PageEvaluate = (expression: string) => Promise<unknown>;

/** Real input for the page: what the DOM cannot be trusted to fake. */
export interface DomDriver {
  open(url: string): Promise<void>;
  clickAt(x: number, y: number): Promise<void>;
  insertText(text: string): Promise<void>;
  press(key: string): Promise<void>;
}

export function createDomProbe(_evaluate: PageEvaluate): AccessibilityProbe { return todo(); }

export function createDomSurface(_evaluate: PageEvaluate, _driver: DomDriver): ReplaySurface { return todo(); }
