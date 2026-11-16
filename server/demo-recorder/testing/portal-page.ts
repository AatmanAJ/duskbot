// A page run in happy-dom 21 for tests, with a person who uses it the way the live view's input arrives: each press
// and key is told to the capture first, then reaches the page. happy-dom lays nothing out, so every element gets a row
// of its own and hit-testing reads the rows.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { Window } from "happy-dom";

import type { RawInput, ScreenSource } from "../capture.ts";
import { createDomProbe, createDomSurface, type DomDriver, type PageEvaluate } from "../accessibility/dom.ts";
import type { AccessibilityProbe } from "../capture.ts";
import type { ReplaySurface } from "../replay.ts";
import { blankPicture, encodePng, fillRect } from "./png.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
export const PORTAL_DIR = join(HERE, "..", "fixtures", "expense-portal");
export const PORTAL_HTML = readFileSync(join(PORTAL_DIR, "portal.html"), "utf8");
export const RECEIPTS_DIR = join(PORTAL_DIR, "receipts");

const ROW = 30;
const LEFT = 20;
const WIDTH = 400;
export const PAGE_SIZE = { width: 640, height: 960 } as const;

const LAYOUT = `(() => {
  const all = () => [...document.querySelectorAll("body *")];
  const rectOf = (element) => {
    const index = all().indexOf(element);
    const y = index < 0 ? -1000 : index * ${ROW};
    return { x: ${LEFT}, y, left: ${LEFT}, top: y, width: ${WIDTH}, height: ${ROW - 2}, right: ${LEFT + WIDTH}, bottom: y + ${ROW - 2}, toJSON() { return {}; } };
  };
  Element.prototype.getBoundingClientRect = function () { return rectOf(this); };
  Element.prototype.getClientRects = function () { return [rectOf(this)]; };
  Element.prototype.scrollIntoView = function () {};
  document.elementFromPoint = (x, y) => {
    const element = all()[Math.floor(y / ${ROW})] || null;
    if (!element || x < ${LEFT} || x > ${LEFT + WIDTH}) return null;
    const overlay = document.querySelector(".overlay");
    return overlay && !overlay.contains(element) ? overlay : element;
  };
})()`;

/** The element a person means by a name: a button or link by its words, a field by its label. */
const FIND = `((name) => {
  const clean = (text) => (text || "").replace(/\\s+/g, " ").trim();
  for (const label of document.querySelectorAll("label")) {
    if (clean(label.textContent) === name && label.control) return label.control;
  }
  for (const element of document.querySelectorAll("button, a, [role=button], summary")) {
    if (clean(element.textContent) === name) return element;
  }
  for (const element of document.querySelectorAll("input, textarea, select")) {
    if (element.getAttribute("aria-label") === name || element.getAttribute("placeholder") === name) return element;
  }
  return null;
})`;

const APPLY_TEXT = `((text) => {
  const field = document.activeElement;
  if (!field || !("value" in field) || field.tagName === "SELECT") return false;
  const whole = field.value.length > 0 && field.selectionStart === 0 && field.selectionEnd === field.value.length;
  field.value = (whole ? "" : field.value) + text;
  field.selectionStart = field.selectionEnd = field.value.length;
  field.dispatchEvent(new Event("input", { bubbles: true }));
  return true;
})`;

const APPLY_KEY = `((key) => {
  const field = document.activeElement;
  if (key === "Backspace" && field && "value" in field) {
    field.value = field.value.slice(0, -1);
    field.dispatchEvent(new Event("input", { bubbles: true }));
    return;
  }
  if (key === "Tab") {
    const stops = [...document.querySelectorAll("input, select, textarea, button, a[href]")].filter((element) => !element.disabled);
    const next = stops[stops.indexOf(field) + 1] || stops[0];
    if (next) next.focus();
    return;
  }
  if (key === "Enter" && field) {
    if (field.tagName === "BUTTON" || field.tagName === "A") field.click();
    else if (field.form && field.tagName !== "TEXTAREA") field.form.requestSubmit();
  }
})`;

export interface Person {
  /** Presses a button or link by its words, or a field by its label. */
  click(name: string): Promise<void>;
  /** Types into the field with focus, a key at a time. */
  type(text: string): Promise<void>;
  press(key: string): Promise<void>;
  paste(text: string): Promise<void>;
  choose(field: string, option: string): Promise<void>;
}

export interface InputTap {
  input(raw: RawInput): Promise<unknown>;
}

export interface TestPage {
  window: Window;
  evaluate: PageEvaluate;
  driver: DomDriver;
  probe: AccessibilityProbe;
  surface: ReplaySurface;
  screen: ScreenSource;
  /** A person whose input is told to `capture` before it reaches the page. */
  person(capture?: InputTap | null): Person;
  url(): string;
  close(): Promise<void>;
}

export type PortalLayout = "standard" | "shifted" | "renamed";

export function portalUrl(layout: PortalLayout = "standard", signedIn = true, survey = false): string {
  const params = new URLSearchParams();
  if (layout !== "standard") params.set("layout", layout);
  if (signedIn) params.set("signedIn", "1");
  if (survey) params.set("survey", "1");
  const query = params.toString();
  return `http://127.0.0.1:4173/portal.html${query ? `?${query}` : ""}`;
}

/** Any page from its HTML; `pages` answers what a later `open` loads, the first page again when it names none. */
export async function openPage(url: string, html: string, pages: (url: string) => string | null = () => null): Promise<TestPage> {
  const window = new Window({ url, settings: { enableJavaScriptEvaluation: true, suppressCodeGenerationFromStringsWarning: true } as never });
  const load = async (to: string, source: string) => {
    window.happyDOM.setURL(to);
    window.document.open();
    window.document.write(source);
    window.document.close();
    await window.happyDOM.waitUntilComplete();
    window.eval(LAYOUT);
  };
  await load(url, html);
  const evaluate: PageEvaluate = async (expression) => {
    const value = window.eval(expression) as unknown;
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value)) as unknown;
  };
  const driver: DomDriver = {
    open: (to) => load(to, pages(to) ?? html),
    async clickAt(x, y) {
      window.eval(`(() => {
        let element = document.elementFromPoint(${x}, ${y});
        if (element && element.tagName === "LABEL" && element.control) element = element.control;
        if (!element) return;
        if (typeof element.focus === "function") element.focus();
        element.click();
      })()`);
      await window.happyDOM.waitUntilComplete();
    },
    async insertText(text) {
      window.eval(`${APPLY_TEXT}(${JSON.stringify(text)})`);
    },
    async press(key) {
      window.eval(`${APPLY_KEY}(${JSON.stringify(key)})`);
      await window.happyDOM.waitUntilComplete();
    },
  };
  let shots = 0;
  const screen: ScreenSource = {
    async frame() {
      const picture = blankPicture(PAGE_SIZE.width, PAGE_SIZE.height, [244, 245, 247]);
      const focus = window.eval(`(() => { const all = [...document.querySelectorAll("body *")]; return [all.length, all.indexOf(document.activeElement), document.title.length]; })()`) as number[];
      fillRect(picture, { x: 0, y: 0, width: 8 + (focus[0]! % 200), height: 6 }, [15, 92, 74]);
      if (focus[1]! >= 0) fillRect(picture, { x: LEFT, y: focus[1]! * ROW, width: WIDTH, height: ROW - 2 }, [255, 255, 255]);
      fillRect(picture, { x: 0, y: PAGE_SIZE.height - 4, width: 4 + (focus[2]! % 100), height: 4 }, [20, 24, 31]);
      shots++;
      return { data: encodePng(picture), type: "image/png", width: PAGE_SIZE.width, height: PAGE_SIZE.height };
    },
  };
  const center = (name: string): { x: number; y: number } => {
    const at = window.eval(`(() => { const element = ${FIND}(${JSON.stringify(name)}); if (!element) return null; const rect = element.getBoundingClientRect(); return [rect.x + rect.width / 2, rect.y + rect.height / 2]; })()`) as [number, number] | null;
    if (!at) throw new Error(`the page shows nothing called ${JSON.stringify(name)}: ${window.document.body.textContent?.replace(/\s+/g, " ").slice(0, 300)}`);
    return { x: at[0], y: at[1] };
  };
  return {
    window,
    evaluate,
    driver,
    probe: createDomProbe(evaluate),
    surface: createDomSurface(evaluate, driver),
    screen,
    person(capture) {
      return {
        async click(name) {
          const { x, y } = center(name);
          await capture?.input({ type: "pointer", action: "down", x, y, button: "left", clickCount: 1 });
          await driver.clickAt(x, y);
          await capture?.input({ type: "pointer", action: "up", x, y, button: "left", clickCount: 1 });
        },
        async type(text) {
          for (const key of text) {
            await capture?.input({ type: "key", action: "down", key, text: key });
            await driver.insertText(key);
            await capture?.input({ type: "key", action: "up", key });
          }
        },
        async press(key) {
          await capture?.input({ type: "key", action: "down", key });
          await driver.press(key);
          await capture?.input({ type: "key", action: "up", key });
        },
        async paste(text) {
          await capture?.input({ type: "text", text });
          await driver.insertText(text);
        },
        async choose(field, option) {
          const { x, y } = center(field);
          await capture?.input({ type: "choose", x, y, label: option });
          window.eval(`(() => {
            const select = ${FIND}(${JSON.stringify(field)});
            const option = [...select.options].find((candidate) => (candidate.label || candidate.text) === ${JSON.stringify(option)});
            if (!option) throw new Error("no such option");
            select.focus();
            select.value = option.value;
            select.dispatchEvent(new Event("input", { bubbles: true }));
            select.dispatchEvent(new Event("change", { bubbles: true }));
          })()`);
        },
      };
    },
    url: () => window.location.href,
    async close() {
      void shots;
      await window.happyDOM.close();
    },
  };
}

export interface Expense {
  ref: string;
  merchant: string;
  amount: number;
  date: string;
  category: string;
  notes: string;
}

export interface PortalPage extends TestPage {
  expenses(): Expense[];
  notice(): string;
}

export async function openPortal(layout: PortalLayout = "standard", options: { signedIn?: boolean; survey?: boolean } = {}): Promise<PortalPage> {
  const page = await openPage(portalUrl(layout, options.signedIn !== false, options.survey === true), PORTAL_HTML);
  return {
    ...page,
    expenses: () => JSON.parse(JSON.stringify(page.window.eval("window.harbor.state.expenses"))) as Expense[],
    notice: () => String(page.window.eval(`(document.querySelector("[role=status]") || {}).textContent || ""`)),
  };
}

/** The receipts beside the portal, as the files a person would point the bot at. */
export function receiptFiles(): Array<{ name: string; content: string }> {
  const names = ["01-blue-door-coffee.txt", "02-lumen-rail.json", "03-papertrail-supply.txt", "04-kestrel-cloud.txt", "05-saffron-table.json", "06-northgate-parking.txt",
    "07-fieldnote-books.txt", "08-marlow-cabs.json", "09-quill-analytics.txt", "10-harvest-bowl.txt", "11-copperline-print.json", "12-tidewater-hotel.txt"];
  return names.map((name) => ({ name, content: readFileSync(join(RECEIPTS_DIR, name), "utf8") }));
}

/** Shows the portal's one task as a person would: a new expense from the first receipt. */
export async function showOneExpense(person: Person): Promise<void> {
  await person.click("New expense");
  await person.click("Merchant");
  await person.type("Blue Door Coffee");
  await person.click("Amount");
  await person.type("18.40");
  await person.click("Date");
  await person.type("2026-11-02");
  await person.choose("Category", "Meals");
  await person.click("Notes");
  await person.type("Team stand-up coffee");
  await person.click("Submit expense");
}
