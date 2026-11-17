// The page-side rule for a secure field is written out again in the script the page runs, so this holds it to the
// one the browser's snapshots mask values by.
import { afterEach, expect, it } from "vitest";

import { isSensitiveInput } from "../browser/cdp/sensitive.ts";
import { openPage, type TestPage } from "./testing/portal-page.ts";

const CASES: Array<{ type: string; autocomplete?: string; name?: string; id?: string; placeholder?: string; aria?: string; label?: string }> = [
  { type: "password" }, { type: "text" }, { type: "text", name: "password" }, { type: "text", id: "userPassword" }, { type: "email", name: "email" },
  { type: "text", autocomplete: "cc-number" }, { type: "text", autocomplete: "cc-exp" }, { type: "tel", name: "phone" }, { type: "text", placeholder: "Card number" },
  { type: "text", label: "One-time code" }, { type: "text", aria: "Verification code" }, { type: "text", name: "otp" }, { type: "text", id: "pin" },
  { type: "text", label: "Security code" }, { type: "text", name: "spinner" }, { type: "text", label: "Shipping address" }, { type: "text", name: "apiKey" },
  { type: "text", name: "api_key" }, { type: "text", label: "Recovery phrase" }, { type: "text", name: "routingNumber" }, { type: "text", label: "Account number" },
  { type: "text", name: "ssn" }, { type: "text", label: "Tax ID" }, { type: "search", placeholder: "Search" }, { type: "text", name: "accessToken" },
  { type: "text", label: "Bearer token" }, { type: "number", name: "amount" }, { type: "text", label: "Passcode" }, { type: "text", name: "cardCvc" }, { type: "url", name: "website" },
];

const pages: TestPage[] = [];
afterEach(async () => { for (const page of pages.splice(0)) await page.close(); });

it("calls a field secure exactly when the browser's own rule does", async () => {
  const attribute = (name: string, value: string | undefined) => (value === undefined ? "" : ` ${name}="${value}"`);
  const html = `<!doctype html><title>Fields</title><form>${CASES.map((each, index) =>
    `${each.label ? `<label for="${each.id ?? `f${index}`}">${each.label}</label>` : ""}<input data-case="${index}" type="${each.type}"${attribute("autocomplete", each.autocomplete)}${attribute("name", each.name)}${attribute("id", each.id ?? (each.label ? `f${index}` : undefined))}${attribute("placeholder", each.placeholder)}${attribute("aria-label", each.aria)}>`).join("")}</form>`;
  const page = await openPage("http://127.0.0.1:4173/fields", html);
  pages.push(page);

  for (const [index, each] of CASES.entries()) {
    const [x, y] = await page.evaluate(`(() => { const rect = document.querySelector('[data-case="${index}"]').getBoundingClientRect(); return [rect.x + rect.width / 2, rect.y + rect.height / 2]; })()`) as [number, number];
    const id = each.id ?? (each.label ? `f${index}` : undefined);
    const expected = isSensitiveInput(each.type, [each.autocomplete, each.name, id, each.placeholder, each.aria, each.label]);
    expect((await page.probe.at({ x, y }))?.secure, JSON.stringify(each)).toBe(expected);
  }
  expect(CASES.filter((each) => isSensitiveInput(each.type, [each.autocomplete, each.name, each.id, each.placeholder, each.aria, each.label])).length).toBeGreaterThan(12);
});
