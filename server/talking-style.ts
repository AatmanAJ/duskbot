// The talking-style guides are plain markdown under prompts/talking-style; the bundle copies them beside itself.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { talkingStyleOf, type TalkingStyle } from "../shared/talking-style.ts";
import { VOICE_RULES } from "./group-voice.ts";

const guides = new Map<TalkingStyle, string>();

function guide(style: TalkingStyle): string {
  const cached = guides.get(style);
  if (cached !== undefined) return cached;
  const here = dirname(fileURLToPath(import.meta.url));
  const path = [join(here, "prompts", "talking-style", `${style}.md`), join(here, "..", "prompts", "talking-style", `${style}.md`)].find((file) => existsSync(file));
  // a build without the guides still talks, just without the style section
  if (!path) return "";
  const text = readFileSync(path, "utf8").trim().replace(/^(#+) /gm, "#$1 ");
  guides.set(style, text);
  return text;
}

/** The person's chosen guide (warm when none), then the rules every turn keeps, in the stable half: a change reaches
 * the next turn the way a SOUL.md edit does. */
export function talkingStylePrompt(style: TalkingStyle | undefined): string {
  const text = guide(talkingStyleOf(style));
  if (!text) return VOICE_RULES;
  return `\n\nYour talking style (the person's choice for all their bots, everywhere you write; their standing instructions win where they differ):\n${text}\n${VOICE_RULES}`;
}
