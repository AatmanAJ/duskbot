// The field a bot meant when it named the box around it: the label, a wrapper div or a dropzone a page draws over its
// real input. A person clicks those and types or picks a file; the field inside is what takes it.
import { DriverError, isGone } from "./errors.ts";
import { resolveInWorld } from "./evaluate.ts";
import type { FrameTree } from "./frames.ts";
import type { NodeHandle } from "./refs.ts";

const INNER = (kind: "text" | "file") => `function () {
  const wanted = ${kind === "file" ? `(el) => el instanceof HTMLInputElement && el.type === "file"` : `(el) => !el.disabled && !el.readOnly && ((el instanceof HTMLTextAreaElement) || (el instanceof HTMLInputElement && !["button","checkbox","color","file","hidden","image","radio","range","reset","submit"].includes((el.type || "text").toLowerCase())) || el.isContentEditable)`};
  if (this instanceof HTMLLabelElement && this.control && wanted(this.control)) return this.control;
  const label = this.closest && this.closest("label");
  if (label && label.control && wanted(label.control)) return label.control;
  const found = [...this.querySelectorAll(${kind === "file" ? `'input[type="file"]'` : `"input,textarea,[contenteditable]"`})].filter(wanted).filter((el) => !el.parentElement || !el.parentElement.isContentEditable);
  return found.length === 1 ? found[0] : null;
}`;

/** The one text field, or file input, inside or labelled by `handle`; null when there is none or more than one. */
export async function innerField(frames: FrameTree, handle: NodeHandle, kind: "text" | "file"): Promise<NodeHandle | null> {
  try {
    return await frames.inWorld(handle.frameId, async (session, contextId) => {
      const objectId = await resolveInWorld(session, handle.backendNodeId, contextId);
      try {
        const { result } = await session.send<{ result: { objectId?: string; subtype?: string } }>("Runtime.callFunctionOn", { objectId, functionDeclaration: INNER(kind), returnByValue: false });
        if (!result.objectId || result.subtype === "null") return null;
        try {
          const { node } = await session.send<{ node: { backendNodeId: number } }>("DOM.describeNode", { objectId: result.objectId });
          return { frameId: handle.frameId, session, backendNodeId: node.backendNodeId };
        } finally {
          void session.send("Runtime.releaseObject", { objectId: result.objectId }).catch(() => {});
        }
      } finally {
        void session.send("Runtime.releaseObject", { objectId }).catch(() => {});
      }
    });
  } catch (error) {
    if (isGone(error) || (error instanceof DriverError && error.code === "not-found")) return null;
    throw error;
  }
}

/** Why a field takes no typed text, said so the bot's next call is the right one. */
export const WHY_NOT_EDITABLE = `function () {
  const tag = this.tagName ? this.tagName.toLowerCase() : "node";
  if (this.disabled || this.getAttribute && this.getAttribute("aria-disabled") === "true") return "disabled";
  if (this.readOnly) return "readonly";
  if (this instanceof HTMLSelectElement) return "select";
  if (this instanceof HTMLInputElement && ["checkbox", "radio"].includes(this.type)) return "check";
  return tag;
}`;

export function notEditableMessage(why: string): string {
  switch (why) {
    case "disabled": return "The field is disabled, so no text was typed. Something on the page has to happen first.";
    case "readonly": return "The field is read-only, so no text was typed: the page sets it from a picker or a menu. Click it and choose the value there.";
    case "select": return "This is a <select>, so no text was typed: use agent_browser_select with the option's label.";
    case "check": return "This is a checkbox or radio button, so no text was typed: use agent_browser_check.";
    default: return `The target is a <${why}>, not a text field, so no text was typed. Name the text field itself (its ref in the snapshot), or click this and type at the focus.`;
  }
}
