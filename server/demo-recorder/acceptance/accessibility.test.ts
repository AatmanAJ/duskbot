// What the page's own structure says about where a person clicked and typed, read the same way for recording and for
// doing it again; and the clicks and keys read out of a desktop viewer's bytes.
import { afterEach, describe, expect, it } from "vitest";

import type { RawInput } from "../capture.ts";
import { createRfbDecoder } from "../rfb-input.ts";
import { openPage, type TestPage } from "../testing/portal-page.ts";

const FORM = `<!doctype html><title>Checkout</title>
<h1>Checkout</h1>
<form>
  <label for="name">Full name</label><input id="name" value="Sam Harbor">
  <label>Email <input type="email" name="email"></label>
  <input type="password" aria-label="Password" value="hunter2-on-the-page">
  <input type="text" name="card-number" placeholder="Card number" autocomplete="cc-number" value="4111 1111 1111 1111">
  <label for="otp">One-time code</label><input id="otp" inputmode="numeric" value="482913">
  <label for="shown">Password</label><input id="shown" type="text" name="password" value="shown-in-the-clear">
  <span id="tip">Delivery note</span><textarea aria-labelledby="tip">Leave at the door</textarea>
  <label for="speed">Delivery</label><select id="speed"><option>Standard</option><option selected>Express</option></select>
  <label><input type="checkbox" checked> Gift wrap</label>
  <button type="button">Place order</button>
  <a href="#terms">Terms</a>
  <div role="button" tabindex="0" aria-label="Close"></div>
  <input type="search" placeholder="Search orders">
  <button type="button" hidden>Ghost</button>
</form>
<div role="status">Order ORD-77 placed</div>
<div role="alert">Card declined</div>`;

const pages: TestPage[] = [];
afterEach(async () => {
  for (const page of pages.splice(0)) await page.close();
});
async function form(): Promise<TestPage> {
  const page = await openPage("http://127.0.0.1:4173/checkout", FORM);
  pages.push(page);
  return page;
}

/** Where the test page's layout puts an element. */
async function centerOf(page: TestPage, selector: string): Promise<{ x: number; y: number }> {
  const [x, y] = await page.evaluate(`(() => { const rect = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return [rect.x + rect.width / 2, rect.y + rect.height / 2]; })()`) as [number, number];
  return { x, y };
}

describe("what the page says about a point", () => {
  it("names a field by its label, however the label is given", async () => {
    const page = await form();
    const named = async (selector: string) => {
      const target = await page.probe.at(await centerOf(page, selector));
      return [target?.role, target?.name];
    };

    expect(await named("#name")).toEqual(["textbox", "Full name"]);
    expect(await named("[name=email]")).toEqual(["textbox", "Email"]);
    expect(await named("textarea")).toEqual(["textbox", "Delivery note"]);
    expect(await named("[type=search]")).toEqual(["searchbox", "Search orders"]);
    expect(await named("#speed")).toEqual(["combobox", "Delivery"]);
    expect(await named("[type=checkbox]")).toEqual(["checkbox", "Gift wrap"]);
    expect(await named("button")).toEqual(["button", "Place order"]);
    expect(await named("a")).toEqual(["link", "Terms"]);
    expect(await named("[role=button]")).toEqual(["button", "Close"]);
  });

  it("gives a field's box and a list's options, and the label's field for a click on the label", async () => {
    const page = await form();
    const select = await page.probe.at(await centerOf(page, "#speed"));
    const viaLabel = await page.probe.at(await centerOf(page, "label[for=name]"));

    expect(select!.choices).toEqual(["Standard", "Express"]);
    expect(select!.bounds).toMatchObject({ width: expect.any(Number), height: expect.any(Number) });
    expect(select!.bounds!.width).toBeGreaterThan(0);
    expect(viaLabel).toMatchObject({ role: "textbox", name: "Full name" });
  });

  it("says nothing for a point with nothing on it", async () => {
    const page = await form();

    expect(await page.probe.at({ x: 5_000, y: 5_000 })).toBeNull();
  });

  it("knows a secure field by its type, its autocomplete, its name and its label", async () => {
    const page = await form();
    const secure = async (selector: string) => (await page.probe.at(await centerOf(page, selector)))?.secure;

    expect(await secure("[type=password]")).toBe(true);
    expect(await secure("[name=card-number]")).toBe(true);
    expect(await secure("#otp")).toBe(true);
    expect(await secure("#shown")).toBe(true);
    expect(await secure("#name")).toBe(false);
    expect(await secure("textarea")).toBe(false);
  });

  it("lists every secure field on screen for the pictures", async () => {
    const page = await form();
    const regions = await page.probe.secureRegions();
    const expected = await Promise.all(["[type=password]", "[name=card-number]", "#otp", "#shown"].map((selector) => centerOf(page, selector)));

    expect(regions).toHaveLength(4);
    for (const point of expected) {
      expect(regions!.some((rect) => point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= rect.y && point.y <= rect.y + rect.height)).toBe(true);
    }
  });

  it("follows focus", async () => {
    const page = await form();
    await page.evaluate(`document.querySelector("#otp").focus()`);
    expect(await page.probe.focused()).toMatchObject({ role: "textbox", name: "One-time code", secure: true });
    await page.evaluate(`document.querySelector("#name").focus()`);
    expect(await page.probe.focused()).toMatchObject({ role: "textbox", name: "Full name", secure: false });
    await page.evaluate(`document.activeElement.blur()`);
    expect(await page.probe.focused()).toBeNull();
  });

  it("reads the page's title, address, headings, notices and alerts", async () => {
    const page = await form();

    expect(await page.probe.context()).toEqual({ title: "Checkout", url: "http://127.0.0.1:4173/checkout" });
    expect(await page.probe.texts!()).toEqual(["Checkout", "Order ORD-77 placed", "Card declined"]);
  });
});

describe("what the page shows when a step is checked", () => {
  it("gives each field's value, and never a secure one", async () => {
    const page = await form();
    const seen = await page.surface.observe();
    const value = (name: string) => seen.fields.filter((field) => field.name === name).map((field) => field.value);

    expect(seen.title).toBe("Checkout");
    expect(seen.url).toBe("http://127.0.0.1:4173/checkout");
    expect(seen.texts).toEqual(expect.arrayContaining(["Checkout", "Order ORD-77 placed", "Card declined"]));
    expect(value("Full name")).toEqual(["Sam Harbor"]);
    expect(value("Delivery")).toEqual(["Express"]);
    expect(value("Delivery note")).toEqual(["Leave at the door"]);
    expect(value("Gift wrap")).toEqual(["checked"]);
    const text = JSON.stringify(seen);
    for (const hidden of ["hunter2-on-the-page", "4111 1111 1111 1111", "482913", "shown-in-the-clear"]) expect(text).not.toContain(hidden);
    expect(seen.fields.find((field) => field.name === "One-time code")!.value).not.toBe("");
  });

  it("fills, chooses and clicks by role and name", async () => {
    const page = await form();

    expect(await page.surface.perform({ do: "fill", role: "textbox", name: "Full name", value: "Alder Wren" })).toEqual({ ok: true });
    expect(await page.surface.perform({ do: "choose", role: "combobox", name: "Delivery", value: "standard" })).toEqual({ ok: true });
    expect(await page.surface.perform({ do: "fill", role: "textbox", name: "delivery  note", value: "Ring twice" })).toEqual({ ok: true });
    expect(await page.surface.perform({ do: "click", role: "checkbox", name: "Gift wrap" })).toEqual({ ok: true });
    expect(await page.evaluate(`[document.querySelector("#name").value, document.querySelector("#speed").value, document.querySelector("textarea").value, document.querySelector("[type=checkbox]").checked]`)).toEqual(["Alder Wren", "Standard", "Ring twice", false]);
  });

  it("says what it could not find, and that a name fits more than one thing", async () => {
    const page = await form();
    const missing = await page.surface.perform({ do: "click", role: "button", name: "Pay now" });
    const twice = await page.surface.perform({ do: "fill", role: "textbox", name: "Password", value: "x" });
    const noOption = await page.surface.perform({ do: "choose", role: "combobox", name: "Delivery", value: "Drone" });
    const ghost = await page.surface.perform({ do: "click", role: "button", name: "Ghost" });

    expect(missing).toMatchObject({ ok: false });
    expect((missing as { reason: string }).reason).toContain("Pay now");
    expect(twice).toMatchObject({ ok: false });
    expect((twice as { reason: string }).reason).toMatch(/more than one/i);
    expect(noOption).toMatchObject({ ok: false });
    expect((noOption as { reason: string }).reason).toContain("Drone");
    expect(ghost).toMatchObject({ ok: false });
  });

  it("types a secret without it showing in what it reports", async () => {
    const page = await form();
    const result = await page.surface.perform({ do: "fill", role: "textbox", name: "One-time code", value: "771204" }, { secret: true });

    expect(result).toEqual({ ok: true });
    expect(await page.evaluate(`document.querySelector("#otp").value`)).toBe("771204");
    expect(JSON.stringify(await page.surface.observe())).not.toContain("771204");
  });
});

const pointer = (mask: number, x: number, y: number) => { const bytes = Buffer.alloc(6); bytes[0] = 5; bytes[1] = mask; bytes.writeUInt16BE(x, 2); bytes.writeUInt16BE(y, 4); return bytes; };
const key = (down: boolean, keysym: number) => { const bytes = Buffer.alloc(8); bytes[0] = 4; bytes[1] = down ? 1 : 0; bytes.writeUInt32BE(keysym, 4); return bytes; };
const updateRequest = () => { const bytes = Buffer.alloc(10); bytes[0] = 3; return bytes; };
const encodings = (count: number) => { const bytes = Buffer.alloc(4 + 4 * count); bytes[0] = 2; bytes.writeUInt16BE(count, 2); return bytes; };

function decode(chunks: Buffer[], skip = 0): RawInput[] {
  const seen: RawInput[] = [];
  const decoder = createRfbDecoder((raw) => seen.push(raw), { skip });
  for (const chunk of chunks) decoder.push(chunk);
  return seen;
}

describe("a desktop viewer's bytes", () => {
  it("become presses, releases and moves of the pointer", () => {
    const seen = decode([Buffer.concat([pointer(0, 100, 200), pointer(1, 100, 200), pointer(0, 100, 200), pointer(4, 300, 40), pointer(0, 300, 40)])]);

    expect(seen).toEqual([
      { type: "pointer", action: "move", x: 100, y: 200 },
      { type: "pointer", action: "down", x: 100, y: 200, button: "left" },
      { type: "pointer", action: "up", x: 100, y: 200, button: "left" },
      { type: "pointer", action: "down", x: 300, y: 40, button: "right" },
      { type: "pointer", action: "up", x: 300, y: 40, button: "right" },
    ]);
  });

  it("become wheel turns for the scroll buttons", () => {
    const seen = decode([Buffer.concat([pointer(16, 50, 60), pointer(0, 50, 60), pointer(8, 50, 60), pointer(0, 50, 60)])]);

    expect(seen.filter((raw) => raw.type === "wheel")).toEqual([
      { type: "wheel", x: 50, y: 60, deltaX: 0, deltaY: 120 },
      { type: "wheel", x: 50, y: 60, deltaX: 0, deltaY: -120 },
    ]);
  });

  it("become keys with their text, named keys, and shortcuts with their modifiers", () => {
    const seen = decode([Buffer.concat([
      key(true, 0x61), key(false, 0x61),
      key(true, 0xffe1), key(true, 0x41), key(false, 0x41), key(false, 0xffe1),
      key(true, 0x01000000 + 0x20ac), key(false, 0x01000000 + 0x20ac),
      key(true, 0xff0d), key(false, 0xff0d),
      key(true, 0xff09), key(true, 0xff08), key(true, 0xff1b),
      key(true, 0xffe3), key(true, 0x73), key(false, 0x73), key(false, 0xffe3),
    ])]);
    const downs = seen.filter((raw): raw is Extract<RawInput, { type: "key" }> => raw.type === "key" && raw.action === "down");

    expect(downs.map((raw) => [raw.key, raw.text, raw.modifiers ?? 0])).toEqual([
      ["a", "a", 0],
      ["A", "A", 8],
      ["€", "€", 0],
      ["Enter", undefined, 0],
      ["Tab", undefined, 0],
      ["Backspace", undefined, 0],
      ["Escape", undefined, 0],
      ["s", undefined, 2],
    ]);
  });

  it("become keys when the viewer sends them the extended way, and pass over what is not input", () => {
    // QEMU Extended Key Event, as noVNC 1.5 sends it to a server that offers the -258 pseudo-encoding.
    const extended = (down: boolean, keysym: number) => { const bytes = Buffer.alloc(12); bytes[0] = 255; bytes[1] = 0; bytes.writeUInt16BE(down ? 1 : 0, 2); bytes.writeUInt32BE(keysym, 4); bytes.writeUInt32BE(0x10, 8); return bytes; };
    const cutText = (text: string) => { const head = Buffer.alloc(8); head[0] = 6; head.writeUInt32BE(text.length, 4); return Buffer.concat([head, Buffer.from(text, "latin1")]); };
    const pixelFormat = () => { const bytes = Buffer.alloc(20); bytes[0] = 0; return bytes; };
    const continuous = () => { const bytes = Buffer.alloc(10); bytes[0] = 150; return bytes; };
    const seen = decode([Buffer.concat([pixelFormat(), continuous(), extended(true, 0x71), cutText("copied words"), extended(false, 0x71), key(true, 0x7a)])]);

    expect(seen).toEqual([
      { type: "key", action: "down", key: "q", text: "q" },
      { type: "key", action: "up", key: "q" },
      { type: "key", action: "down", key: "z", text: "z" },
    ]);
  });

  it("are read across any split, past the other messages and the opening handshake", () => {
    const stream = Buffer.concat([Buffer.alloc(14, 1), encodings(3), updateRequest(), key(true, 0x68), updateRequest(), pointer(1, 7, 9), key(false, 0x68)]);
    const whole = decode([stream], 14);
    const bytewise = decode([...stream].map((byte) => Buffer.from([byte])), 14);

    expect(whole).toEqual([
      { type: "key", action: "down", key: "h", text: "h" },
      { type: "pointer", action: "down", x: 7, y: 9, button: "left" },
      { type: "key", action: "up", key: "h" },
    ]);
    expect(bytewise).toEqual(whole);
  });

  it("stop reading, without throwing, at bytes that are no message", () => {
    const seen = decode([Buffer.concat([key(true, 0x68), Buffer.from([99, 1, 2, 3]), key(true, 0x69)])]);

    expect(seen).toEqual([{ type: "key", action: "down", key: "h", text: "h" }]);
  });
});
