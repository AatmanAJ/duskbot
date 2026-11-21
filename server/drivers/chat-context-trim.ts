// A long browser run on an API model sends the whole turn every step: forty page snapshots and screenshots in, the model
// loses the list it was working through and every request costs more. Before each step, only the latest few page
// snapshots and screenshots stay; older ones become a one-line placeholder. Their refs are stale by then anyway.
import type { ChatContentPart } from "./chat-images.ts";
import type { OpenAIChatMessage } from "./openai-chat.ts";

export const KEEP_SCREENSHOTS = 2;
export const KEEP_PAGE_TEXTS = 2;
/** A short action result ("clicked e12; the page is now …") stays; a page's tree or text is what piles up. */
export const PAGE_TEXT_MIN_CHARS = 2_000;

export const SCREENSHOT_DROPPED = "[older screenshot dropped to keep this run small; take a new one if you need to see the page]";
export const PAGE_TEXT_DROPPED = "[older page snapshot dropped to keep this run small; its refs are stale, so take a new snapshot if you need the page]";

const SCREENSHOT_LEAD = "Screenshot result from tool call ";
const PAGE_TOOL = /(?:^|[_.:-])(?:agent_browser_(?:snapshot|open|navigate|read|batch|scroll)|browser_snapshot)$/;

const isScreenshotMessage = (message: OpenAIChatMessage): message is OpenAIChatMessage & { content: ChatContentPart[] } =>
  message.role === "user" && Array.isArray(message.content) && message.content[0]?.type === "text" && message.content[0].text.startsWith(SCREENSHOT_LEAD)
  && message.content.some((part) => part.type === "image_url");

/** Trims `messages` in place; answers the base64 characters of the screenshots it dropped. */
export function trimBrowserContext(messages: OpenAIChatMessage[], keep = { screenshots: KEEP_SCREENSHOTS, pageTexts: KEEP_PAGE_TEXTS }): number {
  let freed = 0;
  const shots = messages.flatMap((message, index) => (isScreenshotMessage(message) ? [index] : []));
  for (const index of shots.slice(0, Math.max(0, shots.length - keep.screenshots))) {
    const message = messages[index] as OpenAIChatMessage & { content: ChatContentPart[] };
    messages[index] = { ...message, content: message.content.map((part) => {
      if (part.type !== "image_url") return part;
      freed += part.image_url.url.length;
      return { type: "text" as const, text: SCREENSHOT_DROPPED };
    }) };
  }

  const toolNames = new Map<string, string>();
  for (const message of messages) for (const call of message.tool_calls ?? []) toolNames.set(call.id, call.function.name);
  const pages = messages.flatMap((message, index) =>
    message.role === "tool" && typeof message.content === "string" && message.content.length >= PAGE_TEXT_MIN_CHARS
      && PAGE_TOOL.test(toolNames.get(message.tool_call_id ?? "") ?? "") ? [index] : []);
  for (const index of pages.slice(0, Math.max(0, pages.length - keep.pageTexts))) {
    const message = messages[index]!;
    let ok = true;
    try { ok = (JSON.parse(message.content as string) as { ok?: unknown }).ok !== false; } catch {}
    messages[index] = { ...message, content: JSON.stringify({ ok, result: PAGE_TEXT_DROPPED }) };
  }
  return freed;
}
