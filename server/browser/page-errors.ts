// The errors a page shows a person after they act: an alert, a field marked invalid with its message, a toast, a form's
// own validation, red text under a field. A bot that only reads "the page did not move" clicks Continue again; the
// answer of every action names these so the first try's error is seen.
import { valueInWorld } from "./cdp/evaluate.ts";
import type { Tab } from "./tabs.ts";

const MAX_ERRORS = 4;
const ERROR_CHARS = 200;

/** Shown error messages in the main frame, each once, in page order. */
export const ERRORS_EXPRESSION = `(() => {
  const shows = (el) => { if (!el || !el.getBoundingClientRect) return false; const r = el.getBoundingClientRect(); if (r.width <= 0 || r.height <= 0) return false; const s = getComputedStyle(el); return s.visibility !== "hidden" && s.display !== "none" && Number(s.opacity) > 0.05; };
  const clean = (text) => (text || "").replace(/\\s+/g, " ").trim().slice(0, ${ERROR_CHARS});
  const found = [];
  const add = (text) => { const t = clean(text); if (t.length >= 3 && !found.includes(t)) found.push(t); };
  for (const el of document.querySelectorAll('[role="alert"],[role="alertdialog"],[aria-live="assertive"]')) if (shows(el)) add(el.innerText);
  for (const field of document.querySelectorAll('[aria-invalid="true"]')) {
    if (!shows(field)) continue;
    const ids = ((field.getAttribute("aria-errormessage") || "") + " " + (field.getAttribute("aria-describedby") || "")).split(/\\s+/).filter(Boolean);
    const said = ids.map((id) => document.getElementById(id)).filter(shows).map((el) => el.innerText).join(" ");
    const name = field.getAttribute("aria-label") || (field.labels && field.labels[0] && field.labels[0].innerText) || field.name || "a field";
    add(said ? said : clean(name) + " is marked invalid");
  }
  for (const field of document.querySelectorAll("input,select,textarea")) if (field.validationMessage && field.matches(":user-invalid") && shows(field)) add((field.labels && field.labels[0] ? clean(field.labels[0].innerText) + ": " : "") + field.validationMessage);
  const ERRORISH = /(^|[-_ ])(error|errors|invalid|danger|alert|warning|form-error|field-error|helper-text--error)([-_ ]|$)/i;
  for (const el of document.querySelectorAll('[class*="error" i],[class*="invalid" i],[class*="danger" i],[data-testid*="error" i],[id*="error" i]')) {
    if (found.length >= ${MAX_ERRORS * 2}) break;
    const marker = (typeof el.className === "string" ? el.className : "") + " " + (el.id || "") + " " + (el.getAttribute("data-testid") || "");
    if (!ERRORISH.test(marker) || !shows(el) || el.querySelector("input,select,textarea,button")) continue;
    const text = clean(el.innerText);
    if (text.length >= 6 && text.length <= ${ERROR_CHARS}) add(text);
  }
  return found.slice(0, ${MAX_ERRORS});
})()`;

export async function shownErrors(tab: Tab): Promise<string[]> {
  try {
    const found = await valueInWorld<string[]>(tab.page.frames, tab.page.frames.mainFrameId, ERRORS_EXPRESSION);
    return Array.isArray(found) ? found.filter((text) => typeof text === "string") : [];
  } catch {
    return [];
  }
}

/** One line naming the errors the action brought up, and those it left showing; null when the page shows none. */
export function errorsNote(before: readonly string[], after: readonly string[]): string | null {
  const fresh = after.filter((text) => !before.includes(text));
  const kept = after.filter((text) => before.includes(text));
  const quote = (list: readonly string[]) => list.map((text) => JSON.stringify(text)).join(", ");
  if (fresh.length) return `The page now shows an error: ${quote(fresh)}. Read it before anything else: repeating the same action will not get past it.${kept.length ? ` Still showing: ${quote(kept)}.` : ""}`;
  if (kept.length) return `The page still shows an error: ${quote(kept)}.`;
  return null;
}

/** An action that sends what was entered: a submit-like button, Enter, or fill with submit. */
export const SUBMIT_NAME = /\b(continue|next|submit|sign ?in|log ?in|sign ?up|save|send|confirm|verify|pay|place order|search|apply|done|ok)\b/iu;
