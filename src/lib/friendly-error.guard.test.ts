// A caught error's own text never reaches a person: every screen shows it through friendlyError (src/lib/plain-error.ts),
// which keeps a plain sentence and turns a stack, a module address, an errno or a bare status into plain words.
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, sep } from "node:path";
import { describe, expect, it } from "vitest";

const src = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCANNED = ["components", "mobile", "pair"];

const RAW: RegExp[] = [
  // `cause instanceof Error ? cause.message : …`
  /\b(\w+) instanceof Error (?:&& \1\.message )?\? \1\.message\b/,
  // `String(error)` turned into words
  /\bString\((?:e|err|error|cause|reason|failure)(?: \?\? "")?\)/,
  // `{error.message}` rendered straight into the page
  /\{(?:e|err|error|cause|reason|failure)\.message\}/,
  // `.catch((e) => setError(e.message))`
  /\((\w+)(?:: (?:Error|unknown|any))?\) => (?:[\w()]+ && )?set\w+\(\1\.message\b/,
];

// where the raw words are fine, and why
const ALLOWED: Array<{ file: string; line: RegExp; why: string }> = [
  { file: join("components", "connect-apps", "use-connectors.ts"), line: /plainConnectError\(|const message = cause instanceof Error/, why: "raw words only tell failures apart; plainConnectError gives the line a person reads" },
  { file: join("components", "connect-apps", "ComposioKeyStep.tsx"), line: /const message = cause instanceof Error/, why: "raw words only pick a locale key" },
  { file: join("components", "PageBoundary.tsx"), line: /new Error\(String\(error\)\)/, why: "wraps a thrown non-Error; the page shows plain words, never its message" },
  { file: join("components", "bot-panel", "TabBoundary.tsx"), line: /new Error\(String\(error\)\)/, why: "wraps a thrown non-Error; the tab shows plain words, never its message" },
  { file: join("components", "ComputerPanel.tsx"), line: /setError\(cause instanceof Error \? cause : String\(cause\)\)/, why: "keeps the failure itself; panelErrorText (src/lib/computer-messages.ts) words it through friendlyError" },
  { file: join("mobile", "transport") + sep, line: /./, why: "connection logs, never shown" },
];

const files = SCANNED.flatMap((dir) => readdirSync(join(src, dir), { recursive: true, encoding: "utf8" }).map((name) => join(dir, name)))
  .filter((name) => /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name));

const hits = files.flatMap((file) => readFileSync(join(src, file), "utf8").split("\n").flatMap((text, index) =>
  RAW.some((pattern) => pattern.test(text))
  && !ALLOWED.some((allowed) => (file === allowed.file || (allowed.file.endsWith(sep) && file.startsWith(allowed.file))) && allowed.line.test(text))
    ? [`${file}:${index + 1}: ${text.trim()}`]
    : []));

describe("caught errors on screen", () => {
  it("go through friendlyError, never their raw message", () => {
    expect(hits).toEqual([]);
  });

  it("scans the screens it means to", () => {
    expect(files.length).toBeGreaterThan(200);
    expect(files).toContain(join("components", "ChatErrorBanner.tsx"));
  });

  it("would catch a raw render", () => {
    for (const line of [
      "setError(cause instanceof Error ? cause.message : String(cause));",
      "<p>{error.message}</p>",
      ".catch((e) => setError(e.message))",
      "setNotice(String(error));",
    ]) expect(RAW.some((pattern) => pattern.test(line)), line).toBe(true);
    expect(RAW.some((pattern) => pattern.test("setError(friendlyError(cause));"))).toBe(false);
  });
});
