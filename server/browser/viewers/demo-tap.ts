import type { RawInput } from "../../demo-recorder/capture.ts";
import { keyDescription, US_KEYBOARD } from "../cdp/keyboard.ts";

/** Hears what a person does in a browser while they show a task in it, before the page gets it. */
export interface DemoTap {
  /** Settles once the input is recorded. What it answers, if anything, is called when the input has reached the page. */
  input(raw: RawInput): Promise<(() => void) | void>;
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

/** The same for the older view's messages, which name their events as the DevTools protocol does. */
export function liveDemoInputOf(message: Record<string, unknown>): RawInput | null {
  const modifiers = Number.isInteger(message.modifiers) && num(message.modifiers) > 0 && num(message.modifiers) < 16 ? num(message.modifiers) : 0;
  if (message.type === "input_mouse") {
    const point = { x: num(message.x), y: num(message.y) };
    if (message.eventType === "mouseWheel") return { type: "wheel", ...point, deltaX: num(message.deltaX), deltaY: num(message.deltaY) };
    if (message.eventType === "mouseMoved") return { type: "pointer", action: "move", ...point };
    const button = BUTTONS.find((each) => each === message.button);
    if (!button || (message.eventType !== "mousePressed" && message.eventType !== "mouseReleased")) return null;
    return { type: "pointer", action: message.eventType === "mousePressed" ? "down" : "up", ...point, button, clickCount: Math.max(1, Math.trunc(num(message.clickCount) || 1)) };
  }
  if (message.type !== "input_keyboard") return null;
  const text = typeof message.text === "string" && message.text.length > 0 ? message.text : undefined;
  if (message.eventType === "char") return text ? { type: "text", text: text.slice(0, 10_000) } : null;
  const key = typeof message.key === "string" ? message.key.slice(0, 64) : "";
  if (!key || (message.eventType !== "keyDown" && message.eventType !== "keyUp")) return null;
  if (message.eventType === "keyUp") return { type: "key", action: "up", key };
  return { type: "key", action: "down", key, ...(text ? { text: text.slice(0, 16) } : {}), ...(modifiers ? { modifiers } : {}) };
}
