import type { DemoRect, DemoTarget } from "../../../shared/demo-recording.ts";
import { SENSITIVE_FIELD } from "../../browser/cdp/sensitive.ts";
import type { AccessibilityProbe } from "../capture.ts";
import type { Observation, ReplaySurface } from "../replay.ts";

/** Runs an expression in the page, out of reach of the page's own scripts, and returns its JSON value. */
export type PageEvaluate = (expression: string) => Promise<unknown>;

/** Real input for the page: what the DOM cannot be trusted to fake. */
export interface DomDriver {
  open(url: string): Promise<void>;
  clickAt(x: number, y: number): Promise<void>;
  /** Moves the pointer to where the next action lands, so a person watching can follow it. */
  hover?(x: number, y: number): Promise<void>;
  insertText(text: string): Promise<void>;
  /** Types a secret: the page is then closed to the bot's eyes until the secret is gone from it. */
  insertSecret?(text: string): Promise<void>;
  press(key: string): Promise<void>;
}

const NAME_LIMIT = 300;
const VALUE_LIMIT = 500;
const FIELD_LIMIT = 200;
const TEXTS_LIMIT = 40;
/** What a secure field's value reads as: that it has one, and nothing of it. */
export const SECURE_VALUE = "••••";

/**
 * The functions every expression below shares. Security: a secure field's value never leaves the page, and
 * `sensitive` is the rule the browser's snapshots mask values by.
 */
const PAGE = `
const SENSITIVE = new RegExp(${JSON.stringify(SENSITIVE_FIELD.source)}, "i");
const NON_TEXT = ["button", "checkbox", "color", "file", "hidden", "image", "radio", "range", "reset", "submit"];
const CONTROLS = "a[href], button, input, select, textarea, summary, option, [role], [contenteditable=''], [contenteditable='true']";
const clean = (text) => String(text == null ? "" : text).replace(/\\s+/g, " ").trim();
const same = (a, b) => clean(a).toLowerCase() === clean(b).toLowerCase();
const deep = (root, selector, found = []) => {
  for (const element of root.querySelectorAll(selector)) found.push(element);
  for (const element of root.querySelectorAll("*")) if (element.shadowRoot) deep(element.shadowRoot, selector, found);
  return found;
};
const visible = (element) => {
  if (!element || !element.isConnected) return false;
  if (element.closest("[hidden], [aria-hidden='true'], [inert]")) return false;
  const style = getComputedStyle(element);
  if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse") return false;
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
};
const boxOf = (element) => {
  const rect = element.getBoundingClientRect();
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
};
const isField = (element) => element.tagName === "TEXTAREA" || element.tagName === "SELECT" || (element.tagName === "INPUT" && element.type !== "hidden");
const takesText = (element) => element.tagName === "TEXTAREA" || element.isContentEditable === true || (element.tagName === "INPUT" && !NON_TEXT.includes(element.type));
const roleOf = (element) => {
  const given = clean(element.getAttribute("role")).split(" ")[0];
  if (given) return given.toLowerCase();
  const tag = element.tagName;
  if (tag === "A") return element.hasAttribute("href") ? "link" : "";
  if (tag === "BUTTON" || tag === "SUMMARY") return "button";
  if (tag === "TEXTAREA") return "textbox";
  if (tag === "SELECT") return element.multiple || element.size > 1 ? "listbox" : "combobox";
  if (tag === "OPTION") return "option";
  if (tag === "INPUT") {
    const type = (element.getAttribute("type") || "text").toLowerCase();
    if (type === "hidden") return "";
    if (["button", "submit", "reset", "image", "file"].includes(type)) return "button";
    if (type === "checkbox" || type === "radio") return type;
    if (type === "range") return "slider";
    if (type === "search") return "searchbox";
    if (type === "number") return "spinbutton";
    return "textbox";
  }
  if (/^H[1-6]$/.test(tag)) return "heading";
  return element.isContentEditable === true ? "textbox" : "";
};
const labelWords = (label) => {
  const words = (node) => {
    if (node.nodeType === 3) return node.nodeValue;
    if (node.nodeType !== 1 || ["INPUT", "SELECT", "TEXTAREA", "BUTTON", "SCRIPT", "STYLE"].includes(node.tagName)) return " ";
    return [...node.childNodes].map(words).join(" ");
  };
  return clean(words(label));
};
const labelsOf = (element) => {
  const labels = element.labels ? [...element.labels] : [];
  return clean(labels.map(labelWords).join(" "));
};
const nameOf = (element) => {
  const by = clean(element.getAttribute("aria-labelledby"));
  if (by) {
    const root = element.getRootNode();
    const named = clean(by.split(" ").map((id) => { const part = root.getElementById ? root.getElementById(id) : null; return part ? part.textContent : ""; }).join(" "));
    if (named) return named;
  }
  const aria = clean(element.getAttribute("aria-label"));
  if (aria) return aria;
  if (isField(element)) {
    const type = (element.getAttribute("type") || "").toLowerCase();
    if (["button", "submit", "reset"].includes(type)) return clean(element.value) || clean(element.getAttribute("title")) || type;
    return labelsOf(element) || clean(element.getAttribute("placeholder")) || clean(element.getAttribute("title")) || clean(element.getAttribute("alt")) || clean(element.getAttribute("name"));
  }
  const words = clean(element.innerText === undefined ? element.textContent : element.innerText) || clean(element.textContent);
  if (words) return words;
  const picture = element.querySelector ? element.querySelector("img[alt], svg[aria-label]") : null;
  return clean(element.getAttribute("title")) || (picture ? clean(picture.getAttribute("alt") || picture.getAttribute("aria-label")) : "");
};
const onceSecure = globalThis.duskOnceSecure || (globalThis.duskOnceSecure = new WeakSet());
const hidesText = (element) => {
  try { const style = getComputedStyle(element); return (style.webkitTextSecurity || style.getPropertyValue("-webkit-text-security") || "none") !== "none"; } catch { return false; }
};
const looksSensitive = (element) => {
  if (!takesText(element) && element.tagName !== "INPUT") return false;
  const type = (element.getAttribute("type") || "").toLowerCase();
  if (type === "password") return true;
  if (element.tagName === "INPUT" && NON_TEXT.includes(type)) return false;
  if (hidesText(element)) return true;
  const raw = [element.getAttribute("autocomplete"), element.getAttribute("name"), element.id, element.getAttribute("placeholder"), element.getAttribute("aria-label"), labelsOf(element)].filter(Boolean).join(" ");
  const words = raw.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[^A-Za-z0-9]+/g, " ").trim().toLowerCase();
  return SENSITIVE.test(raw) || /(?:^| )(pin|security code)(?: |$)/.test(words);
};
const sensitive = (element) => {
  if (onceSecure.has(element)) return true;
  const secure = looksSensitive(element);
  if (secure) onceSecure.add(element);
  return secure;
};
const describe = (element) => {
  const role = roleOf(element);
  const target = { role: role || "element", name: nameOf(element).slice(0, ${NAME_LIMIT}), secure: sensitive(element), bounds: boxOf(element) };
  if (element.tagName === "SELECT") target.choices = [...element.options].slice(0, 200).map((option) => clean(option.label || option.text).slice(0, ${NAME_LIMIT}));
  return target;
};
const elementAt = (x, y) => {
  let element = document.elementFromPoint(x, y);
  while (element && element.shadowRoot) {
    const inner = element.shadowRoot.elementFromPoint(x, y);
    if (!inner || inner === element) break;
    element = inner;
  }
  return element;
};
const controlFor = (element) => {
  if (!element) return null;
  const label = element.closest ? element.closest("label") : null;
  if (label && label.control) return label.control;
  return (element.closest ? element.closest(CONTROLS) : null) || element;
};
const activeOf = typeof Document === "function" ? Object.getOwnPropertyDescriptor(Document.prototype, "activeElement") : undefined;
const focusedElement = () => {
  let element = activeOf && activeOf.get ? activeOf.get.call(document) : document.activeElement;
  while (element && element.shadowRoot && element.shadowRoot.activeElement) element = element.shadowRoot.activeElement;
  if (!element || element === document.body || element === document.documentElement) return null;
  return element.tagName === "IFRAME" || element.tagName === "FRAME" ? null : element;
};
const valueOf = (element) => {
  if (element.tagName === "SELECT") {
    const chosen = element.options[element.selectedIndex];
    return chosen ? clean(chosen.label || chosen.text) : "";
  }
  if (element.tagName === "INPUT" && (element.type === "checkbox" || element.type === "radio")) return element.checked ? "checked" : "unchecked";
  if (sensitive(element)) return element.value ? ${JSON.stringify(SECURE_VALUE)} : "";
  return String("value" in element ? element.value : element.textContent || "").slice(0, ${VALUE_LIMIT});
};
const shownTexts = () => {
  const texts = [];
  for (const element of deep(document, "h1, h2, h3, h4, h5, h6, [role=heading], [role=status], [role=alert], [aria-live=polite], [aria-live=assertive]")) {
    if (!visible(element)) continue;
    const words = clean(element.innerText === undefined ? element.textContent : element.innerText) || clean(element.textContent);
    if (words && !texts.includes(words)) texts.push(words.slice(0, 400));
    if (texts.length >= ${TEXTS_LIMIT}) break;
  }
  return texts;
};
const FAMILY = { textbox: ["textbox", "searchbox", "spinbutton"], searchbox: ["textbox", "searchbox"], spinbutton: ["textbox", "spinbutton"] };
const locate = (role, name) => {
  const roles = FAMILY[role] || [role];
  const matches = role === "element"
    ? deep(document, "body *").filter((element) => visible(element) && !roleOf(element) && same(element.textContent, name) && ![...element.children].some((child) => same(child.textContent, name)))
    : deep(document, CONTROLS).filter((element) => roles.includes(roleOf(element)) && visible(element) && same(nameOf(element), name));
  const exact = matches.filter((element) => roleOf(element) === role);
  const found = exact.length ? exact : matches;
  return found.length === 1 ? { element: found[0] } : { count: found.length };
};
`;

const call = (body: string) => `(() => {${PAGE}\n${body}\n})()`;
const json = (value: unknown) => JSON.stringify(value);

const AT = (x: number, y: number) => call(`
const element = controlFor(elementAt(${x}, ${y}));
if (!element || !visible(element)) return null;
if (!roleOf(element) && (!clean(element.textContent) || clean(element.textContent).length > 120)) return null;
return describe(element);`);
const FOCUSED = call(`const element = focusedElement(); return element ? describe(element) : null;`);
const CONTEXT = call(`return { title: clean(document.title).slice(0, ${NAME_LIMIT}), url: String(location.href).slice(0, 2000) };`);
const TEXTS = call(`return shownTexts();`);
/** Security: a frame this page cannot read into is covered whole, since a card or password field may be inside it. */
const SECURE_REGIONS = call(`
const regions = [];
const visit = (doc, dx, dy) => {
  for (const element of deep(doc, "input, textarea, [contenteditable=''], [contenteditable='true']")) {
    if (!sensitive(element) || !visible(element)) continue;
    const box = boxOf(element);
    regions.push({ x: box.x + dx, y: box.y + dy, width: box.width, height: box.height });
  }
  for (const frame of deep(doc, "iframe, frame")) {
    if (!visible(frame)) continue;
    const box = boxOf(frame);
    let inner = null;
    try { inner = frame.contentDocument; } catch (error) { inner = null; }
    if (inner && inner.body) visit(inner, dx + box.x, dy + box.y);
    else regions.push({ x: box.x + dx, y: box.y + dy, width: box.width, height: box.height });
  }
};
visit(document, 0, 0);
return regions;`);
const OBSERVE = call(`
const fields = [];
for (const element of deep(document, "input, select, textarea, [contenteditable=''], [contenteditable='true']")) {
  if (!isField(element) && element.isContentEditable !== true) continue;
  if (!visible(element) || ["button", "submit", "reset", "image", "file"].includes(element.type)) continue;
  fields.push({ role: roleOf(element), name: nameOf(element).slice(0, ${NAME_LIMIT}), value: valueOf(element) });
  if (fields.length >= ${FIELD_LIMIT}) break;
}
return { title: clean(document.title).slice(0, ${NAME_LIMIT}), url: String(location.href).slice(0, 2000), texts: shownTexts(), fields };`);

const FIND = (role: string, name: string, then: string) => call(`
const found = locate(${json(role)}, ${json(name)});
if (!found.element) return { missing: true, count: found.count };
const element = found.element;
${then}`);
const AIM = (role: string, name: string) => FIND(role, name, `
if (element.disabled) return { disabled: true };
element.scrollIntoView({ block: "center", inline: "center" });
const box = boxOf(element);
const x = box.x + box.width / 2;
const y = box.y + box.height / 2;
const hit = elementAt(x, y);
const label = hit && hit.closest ? hit.closest("label") : null;
const reached = hit && (hit === element || element.contains(hit) || hit.contains(element) || (label && label.control === element));
return { x, y, covered: !reached };`);
const FOCUS = (role: string, name: string) => FIND(role, name, `
if (!takesText(element)) return { wrongKind: true };
if (element.disabled || element.readOnly) return { disabled: true };
element.scrollIntoView({ block: "center", inline: "center" });
element.focus();
if (typeof element.select === "function") element.select();
else { const range = document.createRange(); range.selectNodeContents(element); const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range); }
const now = focusedElement();
const box = boxOf(element);
return { focused: now === element, secure: sensitive(element), filled: String("value" in element ? element.value : element.textContent || "").length > 0, x: box.x + box.width / 2, y: box.y + box.height / 2 };`);
const FILLED = (role: string, name: string) => FIND(role, name, `return { filled: String("value" in element ? element.value : element.textContent || "").length > 0 };`);
const CHOOSE = (role: string, name: string, value: string) => FIND(role, name, `
if (element.tagName !== "SELECT") return { wrongKind: true };
if (element.disabled) return { disabled: true };
const options = [...element.options];
const labelOf = (option) => clean(option.label || option.text);
let index = options.findIndex((option) => same(labelOf(option), ${json(value)}) || same(option.value, ${json(value)}));
if (index < 0) {
  const starts = options.filter((option) => labelOf(option).toLowerCase().startsWith(clean(${json(value)}).toLowerCase()));
  index = starts.length === 1 ? options.indexOf(starts[0]) : -1;
}
if (index < 0 || options[index].disabled) return { noOption: true };
element.scrollIntoView({ block: "center", inline: "center" });
element.focus();
if (element.selectedIndex !== index) {
  element.selectedIndex = index;
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
}
const box = boxOf(element);
return { chosen: element.selectedIndex === index, x: box.x + box.width / 2, y: box.y + box.height / 2 };`);

const record = (value: unknown): Record<string, unknown> | null => (value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null);
const finite = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : 0);
const words = (value: unknown, limit: number) => (typeof value === "string" ? value.slice(0, limit) : "");

function readRect(value: unknown): DemoRect | null {
  const rect = record(value);
  if (!rect) return null;
  return { x: finite(rect.x), y: finite(rect.y), width: finite(rect.width), height: finite(rect.height) };
}

function readTarget(value: unknown): DemoTarget | null {
  const target = record(value);
  if (!target) return null;
  const bounds = readRect(target.bounds);
  const choices = Array.isArray(target.choices) ? target.choices.filter((choice): choice is string => typeof choice === "string").map((choice) => choice.slice(0, NAME_LIMIT)) : null;
  return {
    role: words(target.role, 60) || "element",
    name: words(target.name, NAME_LIMIT),
    // Security: anything but a plain false from the page reads as secure.
    secure: target.secure !== false,
    ...(bounds ? { bounds } : {}),
    ...(choices ? { choices } : {}),
  };
}

const readTexts = (value: unknown): string[] => (Array.isArray(value) ? value.filter((text): text is string => typeof text === "string").slice(0, TEXTS_LIMIT) : []);

export function createDomProbe(evaluate: PageEvaluate): AccessibilityProbe {
  return {
    kind: "dom",
    at: async (point) => readTarget(await evaluate(AT(finite(point.x), finite(point.y)))),
    focused: async () => readTarget(await evaluate(FOCUSED)),
    async secureRegions() {
      const regions = await evaluate(SECURE_REGIONS).catch(() => null);
      if (!Array.isArray(regions)) return null;
      return regions.map(readRect).filter((rect): rect is DemoRect => rect !== null);
    },
    async context() {
      const context = record(await evaluate(CONTEXT));
      return { title: words(context?.title, NAME_LIMIT), url: words(context?.url, 2_000) };
    },
    texts: async () => readTexts(await evaluate(TEXTS)),
  };
}

const quoted = (role: string, name: string) => `the ${role === "element" ? "words" : role} "${name}"`;
const sentence = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** Why a role and name led nowhere, in words the bot can act on. */
function notFound(result: Record<string, unknown>, role: string, name: string): string | null {
  if (result.missing === true) return finite(result.count) > 1 ? `More than one thing on the page is ${quoted(role, name)}.` : `Could not find ${quoted(role, name)} on the page.`;
  if (result.disabled === true) return sentence(`${quoted(role, name)} is turned off on the page.`);
  return null;
}

export function createDomSurface(evaluate: PageEvaluate, driver: DomDriver): ReplaySurface {
  const ask = async (expression: string) => record(await evaluate(expression)) ?? {};
  return {
    accessibility: "dom",
    async perform(action, options) {
      try {
        if (action.do === "open") {
          await driver.open(action.url);
          return { ok: true };
        }
        if (action.do === "press") {
          await driver.press(action.key);
          return { ok: true };
        }
        const { role, name } = action;
        if (action.do === "click") {
          const aim = await ask(AIM(role, name));
          const lost = notFound(aim, role, name);
          if (lost) return { ok: false, reason: lost };
          if (aim.covered === true) return { ok: false, reason: `Something covers ${quoted(role, name)}, so a click would not reach it.` };
          await driver.clickAt(finite(aim.x), finite(aim.y));
          return { ok: true };
        }
        if (action.do === "choose") {
          const chosen = await ask(CHOOSE(role, name, action.value));
          const lost = notFound(chosen, role, name);
          if (lost) return { ok: false, reason: lost };
          if (chosen.wrongKind === true) return { ok: false, reason: sentence(`${quoted(role, name)} is not a plain list, so it has to be picked from by hand.`) };
          if (chosen.noOption === true) return { ok: false, reason: sentence(`${quoted(role, name)} has no choice "${options?.secret ? "the saved value" : action.value}".`) };
          if (chosen.chosen !== true) return { ok: false, reason: sentence(`${quoted(role, name)} did not take the choice.`) };
          await driver.hover?.(finite(chosen.x), finite(chosen.y)).catch(() => {});
          return { ok: true };
        }
        const focus = await ask(FOCUS(role, name));
        const lost = notFound(focus, role, name);
        if (lost) return { ok: false, reason: lost };
        if (focus.wrongKind === true) return { ok: false, reason: sentence(`${quoted(role, name)} does not take text.`) };
        if (focus.focused !== true) return { ok: false, reason: `Could not put the cursor in ${quoted(role, name)}.` };
        // Security: a saved secret goes only into a field the page itself treats as one, so no check can read it back in the clear.
        if (options?.secret && focus.secure !== true) return { ok: false, reason: sentence(`${quoted(role, name)} takes a saved sign-in, which only the bot's own sign-in tool may fill here.`) };
        await driver.hover?.(finite(focus.x), finite(focus.y)).catch(() => {});
        if (action.value.length > 0) await (options?.secret && driver.insertSecret ? driver.insertSecret(action.value) : driver.insertText(action.value));
        else if (focus.filled === true) await driver.press("Backspace");
        const after = await ask(FILLED(role, name));
        if ((after.filled === true) !== action.value.length > 0) return { ok: false, reason: sentence(`${quoted(role, name)} did not take the text.`) };
        return { ok: true };
      } catch (error) {
        return { ok: false, reason: error instanceof Error && error.message ? error.message.slice(0, 300) : "The page could not be reached." };
      }
    },
    async observe(): Promise<Observation> {
      const seen = await ask(OBSERVE);
      const fields = Array.isArray(seen.fields) ? seen.fields.map(record).filter((field): field is Record<string, unknown> => field !== null) : [];
      return {
        title: words(seen.title, NAME_LIMIT),
        url: words(seen.url, 2_000),
        texts: readTexts(seen.texts),
        fields: fields.slice(0, FIELD_LIMIT).map((field) => ({ role: words(field.role, 60), name: words(field.name, NAME_LIMIT), value: words(field.value, VALUE_LIMIT) })),
      };
    },
  };
}
