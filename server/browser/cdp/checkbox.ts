// Where the "verify you are human" checkbox of a check widget is, so a bot can be offered one click on it. The widget's
// frame is found by its address and measured through its <iframe> in the parent document, which reaches it inside a
// closed shadow root too (Cloudflare's challenge page puts it there). Nothing here clicks.
import { isUnanswered } from "./errors.ts";
import type { FrameTree } from "./frames.ts";
import { checkboxVendor, type CheckboxPoint } from "./settle.ts";

/** Turnstile, reCAPTCHA and hCaptcha draw their box 12 to 44 CSS pixels from the widget's left edge, centred down it. */
const BOX_FROM_LEFT = 28;
const SMALLEST = 20;

export async function checkboxPoint(frames: FrameTree): Promise<CheckboxPoint | null> {
  for (const frame of frames.all()) {
    if (!frame.parentId || !checkboxVendor(frame.url)) continue;
    const parent = frames.get(frame.parentId);
    if (!parent) continue;
    try {
      const { backendNodeId } = await parent.session.send<{ backendNodeId: number }>("DOM.getFrameOwner", { frameId: frame.id });
      await parent.session.send("DOM.scrollIntoViewIfNeeded", { backendNodeId }).catch(() => undefined);
      const { model } = await parent.session.send<{ model: { content: number[]; width: number; height: number } }>("DOM.getBoxModel", { backendNodeId });
      if (model.width < SMALLEST || model.height < SMALLEST) continue;
      const offset = await frames.localRootOffset(parent.session);
      return { x: offset.x + (model.content[0] ?? 0) + Math.min(BOX_FROM_LEFT, model.width / 2), y: offset.y + (model.content[1] ?? 0) + model.height / 2 };
    } catch (error) {
      if (isUnanswered(error)) throw error;
    }
  }
  return null;
}
