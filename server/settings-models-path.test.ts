import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import en from "../src/locales/en.json" with { type: "json" };
import { CODEX_SIGN_IN_EXPIRED, codexNotSignedIn, codexUserError } from "./drivers/codex-errors.ts";
import { ENGLISH_BRIEF } from "./host/brief-words.ts";
import { signedOutNoticeText } from "./limit-notices.ts";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const MODELS = `Settings → ${en["settings.pane.models"]}`;
const RETIRED = /\b(?:Settings,|[Ss]ettings →) (?:[Ee]ngines|AI|[Mm]odel providers)\b/;

function sources(dir: string, keep: (name: string) => boolean): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "node_modules" ? [] : sources(path, keep);
    return keep(name) ? [path] : [];
  });
}

describe("messages that send people to sign in or set up an AI", () => {
  it("name the Models pane as the settings rail shows it", () => {
    expect(codexNotSignedIn()).toContain(`${MODELS} → ChatGPT`);
    expect(CODEX_SIGN_IN_EXPIRED).toContain(`${MODELS} → ChatGPT`);
    expect(codexUserError("provider_not_configured", "own")).toContain(MODELS);
    expect(codexUserError("provider_not_configured", "plan")).toContain(MODELS);
    expect(signedOutNoticeText({ engine: "Claude", bot: "Kai", where: "on this computer" })).toContain(MODELS);
    expect(ENGLISH_BRIEF.signInAgain).toContain(MODELS);
  });

  it("never name a settings screen the app no longer has", () => {
    for (const path of ["Settings → Engines", "settings → engines", "Settings, Model providers", "Settings → AI"]) expect(path).toMatch(RETIRED);
    expect(`${MODELS} → ChatGPT`).not.toMatch(RETIRED);
    const code = (name: string) => /\.(ts|tsx|mts|mjs)$/.test(name) && !/\.test\./.test(name);
    const files = [
      ...["server", "shared", "src", "electron"].flatMap((dir) => sources(join(ROOT, dir), code)),
      ...sources(join(ROOT, "docs"), (name) => name.endsWith(".md")),
      join(ROOT, "src/locales/en.json"),
    ];
    const stale = files.flatMap((file) => readFileSync(file, "utf8").split("\n")
      .map((text, index) => ({ at: `${relative(ROOT, file)}:${index + 1}`, text }))
      .filter(({ text }) => RETIRED.test(text)));
    expect(stale).toEqual([]);
  });
});
