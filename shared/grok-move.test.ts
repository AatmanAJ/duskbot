import { describe, expect, it } from "vitest";

import { GROK_EXPORT_FORMAT, parseGrokExport } from "./grok-import.ts";
import {
  grokExportFileName, grokExportFilePattern, grokExportRequest, grokPromptUrl, GROK_PROMPT_TEXT_MAX, GROK_PROMPT_URL_MAX,
} from "./grok-move.ts";

const ID = "0f3c2a9e-1b7d-4e5f-8a6b-9c0d1e2f3a4b";
/** Long, non-ASCII, with every character Grok Bot's link parser refuses. */
const WORST_NAME = `${"Ünïcødé 名前 #\\\"`\n\t🤖 ".repeat(20)}${"W".repeat(300)}`;

describe("the request a Grok Bot is asked for the rest", () => {
  it("fits Grok Bot's limits for the worst bot name", () => {
    const text = grokExportRequest({ rosterId: ID, name: WORST_NAME });
    expect(text.length).toBeLessThanOrEqual(GROK_PROMPT_TEXT_MAX);
    expect(text).toMatch(/^[\x20-\x7e]+$/);
    expect(text).not.toMatch(/[#\\\n]/);
    expect(text).toContain("No passwords, tokens or keys; header names only.");
    expect(text).toContain(grokExportFileName(ID));
    const url = grokPromptUrl(ID, text)!;
    expect(url.length).toBeLessThanOrEqual(GROK_PROMPT_URL_MAX);
    expect(url).toMatch(/^grokbot:\/\/app\/v1\/prompt\?id=[A-Za-z0-9_-]+&text=[\x21-\x7e]+$/);
    expect(url).not.toMatch(/[#\\]/);
    expect(decodeURIComponent(url.split("&text=")[1]!)).toBe(text);
  });

  it("asks for the shape parseGrokExport reads", () => {
    const text = grokExportRequest({ rosterId: ID, name: "Nova" });
    const shape = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
    const filled = JSON.parse(shape) as { format: string; bots: Array<Record<string, unknown>> };
    expect(filled.format).toBe(GROK_EXPORT_FORMAT);
    filled.bots[0]!.name = "Nova";
    expect(parseGrokExport(JSON.stringify(filled))[0]!.name).toBe("Nova");
  });

  it("gives no link for an id or text Grok Bot would drop", () => {
    expect(grokPromptUrl("../x", "hello")).toBeNull();
    expect(grokPromptUrl(ID, "two\nlines")).toBeNull();
    expect(grokPromptUrl(ID, "é")).toBeNull();
    expect(grokPromptUrl(ID, "x".repeat(GROK_PROMPT_TEXT_MAX + 1))).toBeNull();
    expect(grokPromptUrl(ID, "   ")).toBeNull();
  });

  it("knows the file by its short id, also numbered by a browser", () => {
    const pattern = grokExportFilePattern(ID);
    expect(grokExportFileName(ID)).toBe("grok-bot-export-0f3c2a9e.md");
    for (const name of ["grok-bot-export-0f3c2a9e.md", "grok-bot-export-0f3c2a9e (1).md", "GROK-BOT-EXPORT-0F3C2A9E.json"]) expect(pattern.test(name), name).toBe(true);
    for (const name of ["grok-bot-export-0f3c2a9e.md.exe", "grok-bot-export-0f3c2a9f.md", "x-grok-bot-export-0f3c2a9e.md"]) expect(pattern.test(name), name).toBe(false);
  });
});
