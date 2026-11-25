// How every bot talks: one app-level choice (warm by default), saved with the app config and put in every bot's prompt.
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DATA_DIR, loadConfig, parseConfigPatch, saveConfig } from "./config.ts";
import { buildSystemPrompt } from "./system-prompt.ts";
import { REPLY_HABITS_PROMPT, TALK_HABITS_PROMPT } from "./reply-habits.ts";
import { talkingStylePrompt } from "./talking-style.ts";
import { DEFAULT_TALKING_STYLE, TALKING_STYLES, talkingStyleOf } from "../shared/talking-style.ts";

/** the guide as it sits in the prompt: one heading level under the prompt's own "# How you talk" */
const guide = (style: string) => readFileSync(new URL(`./prompts/talking-style/${style}.md`, import.meta.url), "utf8").trim().replace(/^(#+) /gm, "#$1 ");

describe("the talking style setting", () => {
  it("is casual, warm or native, and warm when none was chosen", () => {
    expect(TALKING_STYLES).toEqual(["casual", "warm", "native"]);
    expect(DEFAULT_TALKING_STYLE).toBe("warm");
    expect(talkingStyleOf(undefined)).toBe("warm");
    expect(talkingStyleOf("loud")).toBe("warm");
    for (const style of TALKING_STYLES) expect(parseConfigPatch({ talkingStyle: style })).toEqual({ talkingStyle: style });
    expect(() => parseConfigPatch({ talkingStyle: "loud" })).toThrow();
  });

  it("is saved with the app config and keeps the rest of it", () => {
    const path = join(DATA_DIR, "config.json");
    mkdirSync(DATA_DIR, { recursive: true });
    try {
      saveConfig({ language: "de" });
      expect(loadConfig().talkingStyle).toBeUndefined();
      saveConfig({ talkingStyle: "casual" });
      expect(loadConfig()).toMatchObject({ talkingStyle: "casual", language: "de" });
      saveConfig({ talkingStyle: "native" });
      expect(JSON.parse(readFileSync(path, "utf8")).talkingStyle).toBe("native");
    } finally {
      rmSync(path, { force: true });
    }
  });
});

describe("the talking style in every bot's prompt", () => {
  it("carries the chosen guide word for word, warm when none was chosen", () => {
    for (const style of TALKING_STYLES) {
      const built = buildSystemPrompt("You are Kiwi.", "", [], undefined, { talkingStyle: style });
      expect(built.text).toContain(guide(style));
      for (const other of TALKING_STYLES.filter((each) => each !== style)) expect(built.text).not.toContain(guide(other));
    }
    expect(buildSystemPrompt("You are Kiwi.", "", []).text).toContain(guide("warm"));
    expect(talkingStylePrompt(undefined)).toBe(talkingStylePrompt("warm"));
  });

  it("sits in the stable half right before the habits, so a change reaches the next turn like a SOUL.md edit", () => {
    const parts = [{ id: "memory", label: "Memory", text: " Your memory: likes tea." }];
    const warm = buildSystemPrompt("You are Kiwi.", "Be brief.", parts, undefined, { talkingStyle: "warm" });
    const casual = buildSystemPrompt("You are Kiwi.", "Be brief.", parts, undefined, { talkingStyle: "casual" });
    expect(warm.sections.map((section) => section.id).slice(3, 6)).toEqual(["talking-style", "talk-habits", "reply-habits"]);
    expect(warm.stable).toContain(talkingStylePrompt("warm").trimStart() + TALK_HABITS_PROMPT);
    expect(warm.volatile).toBe(casual.volatile);
    expect(warm.stable).not.toBe(casual.stable);
  });

  it("leaves tone to the guide: the habits no longer repeat what every guide says", () => {
    expect(REPLY_HABITS_PROMPT).not.toContain("open with the verdict");
    expect(REPLY_HABITS_PROMPT).not.toContain("Never ask for several details at once");
    for (const style of TALKING_STYLES) {
      expect(guide(style)).toContain("Lead with the answer or the result.");
      expect(guide(style)).toContain("Ask one question at a time");
      expect(guide(style)).not.toContain(String.fromCharCode(0x2014));
    }
  });
});
