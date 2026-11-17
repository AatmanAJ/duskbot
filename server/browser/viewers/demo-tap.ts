import type { RawInput } from "../../demo-recorder/capture.ts";
import { keyDescription, US_KEYBOARD } from "../cdp/keyboard.ts";

/** Hears what a person does in a browser while they show a task in it, before the page gets it. */
export interface DemoTap {
  input(raw: RawInput): Promise<void>;
}

const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : 0);
const BUTTONS = ["left", "middle", "right"] as const;

/** A viewer's message as a recording reads it; null for one that is not something done to the page. */
export function demoInputOf(message: Record<string, unknown>): RawInput | null {
  const modifiers = Number.isInteger(message.modifiers) && num(message.modifiers) > 0 && num(message.modifiers) < 16 ? num(message.modifiers) : 0;
  if (message.type === "mouse") {
    const action = message.action === "down" ? "down" : message.action === "up" ? "up" : "move";
    const button = BUTTONS.find((each) => each === message.button);
    if (action !== "move" && !button) return null;
    return { type: "pointer", action, x: num(message.x), y: num(message.y), ...(button ? { button } : {}), ...(action === "move" ? {} : { clickCount: Math.max(1, Math.trunc(num(message.clickCount) || 1)) }) };
  }
  if (message.type === "wheel") return { type: "wheel", x: num(message.x), y: num(message.y), deltaX: num(message.deltaX), deltaY: num(message.deltaY) };
  if (message.type === "key") {
    const key = typeof message.key === "string" ? message.key.slice(0, 64) : "";
    const code = typeof message.code === "string" ? message.code.slice(0, 64) : "";
    if (!key && !code) return null;
    if (message.action === "up") return { type: "key", action: "up", key: key || code };
    const named = US_KEYBOARD[code] ?? US_KEYBOARD[key];
    const layout = named ? keyDescription(US_KEYBOARD[code] ? code : key, modifiers) : null;
    const text = typeof message.text === "string" ? message.text.slice(0, 16) : layout?.text || undefined;
    return { type: "key", action: "down", key: key || code, ...(text ? { text } : {}), ...(modifiers ? { modifiers } : {}) };
  }
  if (message.type === "text") return typeof message.text === "string" && message.text.length > 0 ? { type: "text", text: message.text.slice(0, 10_000) } : null;
  if (message.type === "navigate") return typeof message.url === "string" && message.url ? { type: "open", url: message.url.slice(0, 2_000) } : null;
  return null;
}
