import type { FillLoginDeps } from "../login-fill.ts";

/** The page in front of a bot's browser, as the recorder and the replayer use it on every browser the app runs. */
export interface DemoPagePort {
  /** An expression's value from the page; null when the browser gave nothing. */
  evaluate(expression: string): Promise<unknown>;
  /** Text typed into the focused field as real input. */
  insertText(text: string): Promise<void>;
  /** A key pressed at the focused element. */
  press(key: string): Promise<void>;
  /** A real click on the one element a CSS selector names. */
  click(selector: string): Promise<void>;
  /** Goes to an address in the tab in front. */
  open(url: string): Promise<void>;
  /** Files for the file picker a CSS selector names; absent where the browser cannot take files. */
  upload?(selector: string, paths: readonly string[]): Promise<void>;
  /** Runs a script in every document this tab opens from now on, before the page's own; answers how to stop. Absent where the browser cannot. */
  everyDocument?(script: string): Promise<() => void>;
}

/** fill_login's reads and typing, which every browser the app runs already offers. */
export type LoginInput = Pick<FillLoginDeps, "engine" | "insertText" | "press" | "click">;

export interface DemoPortExtras {
  open?(url: string): Promise<void>;
  upload?(selector: string, paths: readonly string[]): Promise<void>;
  everyDocument?(script: string): Promise<() => void>;
}

/** The port over the reads and typing a browser already gives fill_login, with what only some browsers can do added. */
export function demoPortOf(input: LoginInput, extras: DemoPortExtras = {}): DemoPagePort {
  const evaluate = async (expression: string) => (await input.engine(["eval", expression]))?.result ?? null;
  return {
    evaluate,
    insertText: (text) => input.insertText(text),
    press: (key) => input.press(key),
    click: (selector) => input.click(selector),
    // Answered before the page goes, so the evaluation is not cut off by its own navigation.
    open: extras.open ?? (async (url) => { await evaluate(`(() => { setTimeout(() => location.assign(${JSON.stringify(url)}), 0); return "going"; })()`); }),
    ...(extras.upload ? { upload: extras.upload } : {}),
    ...(extras.everyDocument ? { everyDocument: extras.everyDocument } : {}),
  };
}
