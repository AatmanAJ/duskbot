/** Why a character is marked: it draws nothing, it reorders the text around it, it looks like a plain space but is
 * another character, or it is a terminal control. Any of them can make a command read differently from what runs. */
export type HiddenCharacterKind = "invisible" | "direction" | "space" | "control";

export interface HiddenCharacter {
  /** UTF-16 offset in the original text. */
  index: number;
  char: string;
  /** `U+200B`, the form a mark shows. */
  code: string;
  /** The Unicode name where it is a common one, otherwise the code again. */
  name: string;
  kind: HiddenCharacterKind;
}

export type RevealedPart = { text: string } | { hidden: HiddenCharacter };

const NAMES: Record<number, string> = {
  0x00a0: "No-break space",
  0x00ad: "Soft hyphen",
  0x034f: "Combining grapheme joiner",
  0x061c: "Arabic letter mark",
  0x115f: "Hangul choseong filler",
  0x1160: "Hangul jungseong filler",
  0x180e: "Mongolian vowel separator",
  0x200b: "Zero-width space",
  0x200c: "Zero-width non-joiner",
  0x200d: "Zero-width joiner",
  0x200e: "Left-to-right mark",
  0x200f: "Right-to-left mark",
  0x2028: "Line separator",
  0x2029: "Paragraph separator",
  0x202a: "Left-to-right embedding",
  0x202b: "Right-to-left embedding",
  0x202c: "Pop directional formatting",
  0x202d: "Left-to-right override",
  0x202e: "Right-to-left override",
  0x202f: "Narrow no-break space",
  0x2060: "Word joiner",
  0x2066: "Left-to-right isolate",
  0x2067: "Right-to-left isolate",
  0x2068: "First strong isolate",
  0x2069: "Pop directional isolate",
  0x2800: "Braille pattern blank",
  0x3000: "Ideographic space",
  0x3164: "Hangul filler",
  0xfeff: "Zero-width no-break space",
  0xffa0: "Halfwidth Hangul filler",
};

const DIRECTION = /^[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]$/u;
const CONTROL = /^[\p{Cc}\p{Cs}]$/u;
const SPACE = /^\p{Zs}$/u;
const INVISIBLE = /^[\p{Cf}\u115f\u1160\u2028\u2029\u2800\u3164\uffa0]$/u;
const SELECTOR = (code: number) => code === 0x034f || (code >= 0xfe00 && code <= 0xfe0f) || (code >= 0xe0100 && code <= 0xe01ef);
const PICTOGRAPH = /^\p{Extended_Pictographic}$/u;
const KEYCAP_BASE = /^[0-9#*]$/;
const BLACK_FLAG = 0x1f3f4;
const TAG = (code: number) => code >= 0xe0020 && code <= 0xe007f;

function kindOf(char: string): HiddenCharacterKind | null {
  if (char === "\t" || char === "\n" || char === "\r" || char === " ") return null;
  if (DIRECTION.test(char)) return "direction";
  if (CONTROL.test(char)) return "control";
  if (SPACE.test(char)) return "space";
  if (INVISIBLE.test(char) || SELECTOR(char.codePointAt(0)!)) return "invisible";
  return null;
}

/** Joiners, presentation selectors and flag tag letters inside an emoji are drawn as that emoji. */
function partOfEmoji(chars: readonly string[], at: number): boolean {
  const code = chars[at]!.codePointAt(0)!;
  const before = chars[at - 1];
  const after = chars[at + 1];
  if (code === 0xfe0f || code === 0xfe0e) return before !== undefined && (PICTOGRAPH.test(before) || KEYCAP_BASE.test(before));
  if (code === 0x200d) {
    const joined = before !== undefined && (PICTOGRAPH.test(before) || before === "\ufe0f" || /^\p{Emoji_Modifier}$/u.test(before));
    return joined && after !== undefined && PICTOGRAPH.test(after);
  }
  if (TAG(code)) {
    let start = at;
    while (start > 0 && TAG(chars[start - 1]!.codePointAt(0)!)) start -= 1;
    return start > 0 && chars[start - 1]!.codePointAt(0) === BLACK_FLAG;
  }
  return false;
}

function describe(char: string, index: number, kind: HiddenCharacterKind): HiddenCharacter {
  const point = char.codePointAt(0)!;
  const code = `U+${point.toString(16).toUpperCase().padStart(4, "0")}`;
  return { index, char, code, name: NAMES[point] ?? code, kind };
}

export function findHiddenCharacters(text: string): HiddenCharacter[] {
  const found: HiddenCharacter[] = [];
  const chars = Array.from(text);
  let index = 0;
  chars.forEach((char, at) => {
    const kind = kindOf(char);
    if (kind && !partOfEmoji(chars, at)) found.push(describe(char, index, kind));
    index += char.length;
  });
  return found;
}

export function hasHiddenCharacters(text: string): boolean {
  return findHiddenCharacters(text).length > 0;
}

/** The text split so every hidden character stands alone, for a renderer to draw it as a visible mark. */
export function revealHiddenCharacters(text: string): RevealedPart[] {
  const parts: RevealedPart[] = [];
  let from = 0;
  for (const hidden of findHiddenCharacters(text)) {
    if (hidden.index > from) parts.push({ text: text.slice(from, hidden.index) });
    parts.push({ hidden });
    from = hidden.index + hidden.char.length;
  }
  if (from < text.length) parts.push({ text: text.slice(from) });
  return parts;
}

/** The text with every hidden character written as its code in brackets, for places that only take a plain string. */
export function spellOutHiddenCharacters(text: string): string {
  return revealHiddenCharacters(text).map((part) => ("text" in part ? part.text : `[${part.hidden.code}]`)).join("");
}
