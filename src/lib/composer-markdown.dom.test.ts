// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";

import { applyTextEdit } from "./composer-markdown";

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

it("types the edit through the browser when it can, so undo takes it back", () => {
  const field = document.body.appendChild(document.createElement("textarea"));
  field.value = "- milk";
  const typed = vi.fn(() => true);
  Object.defineProperty(document, "execCommand", { value: typed, configurable: true });
  applyTextEdit(field, { from: 6, to: 6, insert: "\n- ", caret: 9 });
  expect(typed).toHaveBeenCalledWith("insertText", false, "\n- ");
  applyTextEdit(field, { from: 0, to: 2, insert: "", caret: 0 });
  expect(typed).toHaveBeenLastCalledWith("delete");
});

it("falls back to replacing the range and announcing the input when the browser will not type it", () => {
  const field = document.body.appendChild(document.createElement("textarea"));
  field.value = "- milk";
  Object.defineProperty(document, "execCommand", { value: () => false, configurable: true });
  const inputs: string[] = [];
  field.addEventListener("input", () => inputs.push(field.value));
  applyTextEdit(field, { from: 6, to: 6, insert: "\n- ", caret: 9 });
  expect(field.value).toBe("- milk\n- ");
  expect([field.selectionStart, field.selectionEnd]).toEqual([9, 9]);
  expect(inputs).toEqual(["- milk\n- "]);
});
