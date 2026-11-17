import { describe, expect, it } from "vitest";

import { chatImageBudget, chatToolImages, CHAT_IMAGE_BUDGET } from "./chat-images.ts";
import { PAGE_TEXT_DROPPED, PAGE_TEXT_MIN_CHARS, SCREENSHOT_DROPPED, trimBrowserContext } from "./chat-context-trim.ts";
import type { OpenAIChatMessage } from "./openai-chat.ts";

const image = (seed: string) => ({ type: "image_url" as const, image_url: { url: `data:image/png;base64,${seed.repeat(1_000)}` } });
const page = (n: number) => JSON.stringify({ ok: true, result: `- link "Profile ${n}" [ref=e${n}]\n`.repeat(PAGE_TEXT_MIN_CHARS / 20) });

/** One DM: open the person's profile (a page snapshot), click Message, type, send, and a screenshot to check it. */
function dmRound(n: number): OpenAIChatMessage[] {
  return [
    { role: "assistant", content: null, tool_calls: [
      { id: `open${n}`, type: "function", function: { name: "browser__agent_browser_open", arguments: "{}" } },
      { id: `send${n}`, type: "function", function: { name: "browser__agent_browser_click", arguments: "{}" } },
      { id: `shot${n}`, type: "function", function: { name: "browser__agent_browser_screenshot", arguments: "{}" } },
    ] },
    { role: "tool", tool_call_id: `open${n}`, content: page(n) },
    { role: "tool", tool_call_id: `send${n}`, content: JSON.stringify({ ok: true, result: `Clicked. Text that appeared on the page: Sent to person ${n}.` }) },
    { role: "tool", tool_call_id: `shot${n}`, content: JSON.stringify({ ok: true, result: "screenshot" }) },
    { role: "user", content: chatToolImages(`shot${n}`, [image(String(n % 10))]) },
  ];
}

describe("keeping a long browser run small", () => {
  it("keeps the person's request, every action result and only the latest two snapshots and screenshots", () => {
    const request: OpenAIChatMessage = { role: "user", content: [{ type: "text", text: "DM these 94 people" }, image("r")] };
    const messages: OpenAIChatMessage[] = [{ role: "system", content: "You are a bot." }, request, ...Array.from({ length: 10 }, (_, i) => dmRound(i + 1)).flat()];
    const before = JSON.stringify(messages).length;
    const freed = trimBrowserContext(messages);
    expect(freed).toBe(8 * image("x").image_url.url.length);
    expect(messages[1]).toBe(request);
    const json = JSON.stringify(messages);
    expect(json.length).toBeLessThan(before / 2);
    expect(json.split(SCREENSHOT_DROPPED).length - 1).toBe(8);
    expect(json.split(PAGE_TEXT_DROPPED.replace(/"/g, '\\"')).length - 1).toBe(8);
    expect(json).toContain("Profile 10");
    expect(json).toContain("Profile 9");
    expect(json).not.toContain("Profile 8\\");
    for (let n = 1; n <= 10; n++) expect(json).toContain(`Sent to person ${n}.`);
    // a second trim changes nothing more
    expect(trimBrowserContext(messages)).toBe(0);
  });

  it("gives the dropped screenshots back to the turn's image budget", () => {
    const retain = chatImageBudget();
    const big = [{ type: "image_url" as const, image_url: { url: "x".repeat(CHAT_IMAGE_BUDGET - 10) } }];
    retain(big);
    expect(() => retain(big)).toThrow(/image budget/);
    retain.release(CHAT_IMAGE_BUDGET - 10);
    expect(() => retain(big)).not.toThrow();
  });
});
