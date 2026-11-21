// A slider set to a value the way a person with a keyboard sets it: focus, then arrow keys until it reads the value.
import { DriverError } from "./errors.ts";
import { callOnNode } from "./evaluate.ts";
import type { FrameTree } from "./frames.ts";
import type { Keyboard } from "./keyboard.ts";
import type { NodeHandle } from "./refs.ts";

const MAX_PRESSES = 400;

export type SliderState = { kind: "range"; min: number; max: number; value: number } | { kind: "aria"; min: number; max: number; value: number } | null;

export const SLIDER_STATE = `function () {
  if (this instanceof HTMLInputElement && this.type === "range") return { kind: "range", min: Number(this.min || 0), max: Number(this.max || 100), value: Number(this.value) };
  const role = this.getAttribute && this.getAttribute("role");
  if ((role === "slider" || role === "spinbutton") && this.getAttribute("aria-valuenow") !== null) {
    return { kind: "aria", min: Number(this.getAttribute("aria-valuemin") ?? -Infinity), max: Number(this.getAttribute("aria-valuemax") ?? Infinity), value: Number(this.getAttribute("aria-valuenow")) };
  }
  return null;
}`;

const SET_RANGE = `function (value) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(this, String(value));
  this.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  this.dispatchEvent(new Event("change", { bubbles: true }));
  return Number(this.value);
}`;

/** "$750", "750", "1,200.5" and "75%" all read as their number. */
export function sliderNumber(text: string): number | null {
  const match = /-?\d[\d,]*(?:\.\d+)?/u.exec(text);
  if (!match) return null;
  const value = Number(match[0].replace(/,/gu, ""));
  return Number.isFinite(value) ? value : null;
}

export async function sliderState(frames: FrameTree, handle: NodeHandle): Promise<SliderState> {
  return callOnNode<SliderState>(frames, handle, SLIDER_STATE).catch(() => null);
}

/** Sets the slider to `text`'s number; answers the value it ended on. */
export async function setSlider(frames: FrameTree, keyboard: Keyboard, handle: NodeHandle, state: NonNullable<SliderState>, text: string): Promise<number> {
  const wanted = sliderNumber(text);
  if (wanted === null) throw new DriverError("not-editable", `This is a slider; give it a number, not ${JSON.stringify(text.slice(0, 40))}.`);
  if (wanted < state.min || wanted > state.max) throw new DriverError("refused", `This slider goes from ${state.min} to ${state.max}; ${wanted} is outside it.`);
  if (state.kind === "range") return callOnNode<number>(frames, handle, SET_RANGE, [wanted]);
  await handle.session.send("DOM.focus", { backendNodeId: handle.backendNodeId }).catch(() => undefined);
  const read = async () => (await sliderState(frames, handle))?.value ?? Number.NaN;
  let value = state.value;
  if (wanted === state.min) { await keyboard.press("Home"); return read(); }
  if (wanted === state.max) { await keyboard.press("End"); return read(); }
  let unchanged = 0;
  for (let presses = 0; presses < MAX_PRESSES && value !== wanted; presses++) {
    const up = wanted > value;
    await keyboard.press(up ? "ArrowRight" : "ArrowLeft");
    const next = await read();
    if (next === value) {
      if (++unchanged >= 2) throw new DriverError("not-editable", `The slider does not move with the arrow keys (it stays at ${value}). Drag its handle with agent_browser_drag instead.`);
      continue;
    }
    unchanged = 0;
    // A step that jumps past the value stops at whichever side is nearer.
    if (up ? next > wanted : next < wanted) {
      if (Math.abs(next - wanted) > Math.abs(value - wanted)) await keyboard.press(up ? "ArrowLeft" : "ArrowRight");
      return read();
    }
    value = next;
  }
  return value;
}
