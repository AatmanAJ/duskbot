// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it } from "vitest";
import { CARD_LEAVE_MS, DWELL_MS, Dock, HIDE_MS } from "./Dock";
import { REVEAL } from "./edge-intent";
import { HISTORY } from "./MiniChat";
import { SETTLED_MS } from "./shared";
import type { AmbientAct, AmbientBot, AmbientBridge, AmbientSnapshot } from "./types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;

const bot = (id: string, fields: Partial<AmbientBot>): AmbientBot => ({
  id, threadId: `t-${id}`, name: id, color: "blue", body: null, face: null, avatar: null, status: "idle", detail: "", line: "", at: 1, unread: false, asks: 0,
  approval: null, waits: null, question: null, ...fields,
});
const wait = (ms: number) => act(async () => new Promise((resolve) => setTimeout(resolve, ms)));
/** as a person reaching for the dock: the pointer comes across the screen to the edge and rests there until it slides out
 * (a point inside the dock's edge zone here, where happy-dom lays nothing out) */
const arrive = async () => {
  await act(async () => {
    document.dispatchEvent(new MouseEvent("mousemove", { clientX: 100, clientY: 360 }));
    document.dispatchEvent(new MouseEvent("mousemove", { clientX: 400, clientY: 360 }));
  });
  await wait(REVEAL.dwellMs + 40);
};
const LABELS = { allow: "Allow", deny: "Deny", answer: "Type an answer", send: "Send", sent: "Sent", replyTo: "Reply to {name}", stop: "Stop {name}", dismiss: "Dismiss" };

async function mount(bots: AmbientBot[]) {
  let feed: (snapshot: AmbientSnapshot) => void = () => {};
  const acts: AmbientAct[] = [];
  const seen: string[][] = [];
  const opened: string[] = [];
  let settled = 0;
  const bridge: AmbientBridge = {
    surface: "dock", onState: (cb) => { feed = cb; return () => {}; }, onLayout: () => () => {}, pointer() {}, open: (botId) => opened.push(botId), act: (next) => acts.push(next), order() {}, ready() {},
    onSeen: () => () => {}, seen: (keys) => seen.push(keys), settled: () => { settled += 1; },
  };
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  await act(async () => root.render(createElement(Dock, { bridge })));
  await act(async () => feed({ lang: "en", labels: LABELS, bots }));
  const cell = (id: string) => host.querySelector<HTMLElement>(`[data-row="${id}"]`)!;
  // as a browser does: the pointer brings the column out, reaches the mascot, then moves
  const hover = async (id: string) => {
    if (host.querySelector(".amb-dock[data-hidden]")) await arrive();
    await act(async () => {
      cell(id).dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
      document.dispatchEvent(new MouseEvent("mousemove", { clientX: 400, clientY: 360 }));
    });
  };
  return { host, acts, seen, opened, settledCount: () => settled, cell, hover, unmount: () => act(async () => root.unmount()) };
}

afterEach(() => { document.body.innerHTML = ""; });

it("is a column of every bot in the person's order, with a bubble only for news", async () => {
  const { host, cell, unmount } = await mount([
    bot("Moss", {}),
    bot("Nova", { status: "working", detail: "Comparing flights" }),
    bot("Quill", { status: "needs-you", waits: "approval", asks: 2 }),
    bot("Rivet", { status: "done", unread: true, line: "The footer is fixed." }),
    bot("Echo", { status: "error", unread: true, line: "Couldn't reach Gmail." }),
    // what the person is watching in the app: nothing to point at here
    bot("Juno", { status: "done", unread: true, line: "Booked.", quiet: true }),
  ]);
  expect([...host.querySelectorAll("[data-row]")].map((row) => row.getAttribute("data-row"))).toEqual(["Moss", "Nova", "Quill", "Rivet", "Echo", "Juno"]);
  const bubble = (id: string) => cell(id).querySelector(".amb-bubble");
  expect([bubble("Moss"), bubble("Nova"), bubble("Juno")]).toEqual([null, null, null]);
  expect([bubble("Quill")?.getAttribute("data-kind"), bubble("Quill")?.textContent]).toEqual(["ask", "2"]);
  expect(bubble("Rivet")).toBeNull();
  expect(bubble("Echo")?.getAttribute("data-kind")).toBe("error");
  // how each is doing, in the island's colours: blue while working, green for a reply not yet seen, nothing at rest
  const dot = (id: string) => cell(id).querySelector(".amb-state-dot")?.getAttribute("data-state") ?? null;
  expect(["Moss", "Nova", "Quill", "Rivet", "Echo", "Juno"].map(dot)).toEqual([null, "working", null, "done", null, null]);
  // no list of words in the column itself
  expect(host.querySelector(".amb-dock-column .amb-row")).toBeNull();
  await unmount();
});

it("keeps one card for the whole visit: it waits for a rest before the first bot, then moves bot to bot as the same node", async () => {
  const { host, hover, unmount } = await mount(["Nova", "Rivet", "Juno"].map((id) => bot(id, { status: "done", unread: true, line: `${id} replied.` })));
  const card = host.querySelector(".amb-card")!;
  await hover("Nova");
  // landing on a bot as the dock comes out is not choosing it
  expect(card.getAttribute("data-card")).toBeNull();
  await wait(DWELL_MS + 60);
  expect(card.getAttribute("data-card")).toBe("Nova");
  const trail: (string | null)[] = [];
  for (const id of ["Rivet", "Juno", "Nova"]) {
    await hover(id);
    expect(host.querySelector(".amb-card")).toBe(card);
    trail.push(card.getAttribute("data-card"));
  }
  expect(trail).toEqual(["Rivet", "Juno", "Nova"]);
  expect(host.querySelectorAll(".amb-card")).toHaveLength(1);
  await unmount();
});

it("answers an ask in the card and says so, without opening the chat", async () => {
  const { host, acts, hover, unmount } = await mount([
    bot("Juno", { status: "needs-you", waits: "question", asks: 1, question: { requestId: "q1", threadId: "t-Juno", title: "Aisle or window?", choices: ["Aisle", "Window"], custom: true } }),
    bot("Quill", { status: "needs-you", waits: "approval", asks: 1, detail: "Wants to run a command", approval: { requestId: "r1", threadId: "t-Quill", title: "npm test" } }),
  ]);
  await hover("Juno");
  await wait(DWELL_MS + 60);
  const card = host.querySelector(".amb-card")!;
  expect(card.querySelector(".amb-chat-ask-line")?.textContent).toBe("Aisle or window?");
  await act(async () => [...card.querySelectorAll<HTMLButtonElement>(".amb-pill")].find((pill) => pill.textContent === "Window")!.click());
  await hover("Quill");
  await act(async () => [...card.querySelectorAll<HTMLButtonElement>(".amb-pill")].find((pill) => pill.textContent === "Allow")!.click());
  expect(acts).toEqual([
    { kind: "answer", botId: "Juno", threadId: "t-Juno", requestId: "q1", text: "Window" },
    { kind: "allow", botId: "Quill", threadId: "t-Quill", requestId: "r1" },
  ]);
  await hover("Juno");
  expect(card.querySelector(".amb-chat-status")?.textContent).toBe("Sent");
  await unmount();
});

it("shows the hovered bot's recent chat, even an idle one's, and a reply sent there goes to that chat", async () => {
  const { host, acts, hover, unmount } = await mount([
    bot("Ada", { chat: [
      { id: "m1", from: "you", text: "Can you check the invoice from Friday?", at: 1 },
      { id: "m2", from: "bot", text: "Done: it was paid on Saturday, receipt is in your inbox.", at: 2 },
    ] }),
  ]);
  await hover("Ada");
  await wait(DWELL_MS + 60);
  const card = host.querySelector(".amb-card")!;
  const bubbles = [...card.querySelectorAll(".amb-bubble-msg")].map((bubble) => [bubble.getAttribute("data-from"), bubble.textContent]);
  expect(bubbles).toEqual([["you", "Can you check the invoice from Friday?"], ["bot", "Done: it was paid on Saturday, receipt is in your inbox."]]);
  const input = card.querySelector<HTMLInputElement>(".amb-chat-compose .amb-reply-input")!;
  expect(input.getAttribute("aria-label")).toBe("Reply to Ada");
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "Thanks, file it under taxes");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => card.querySelector<HTMLFormElement>(".amb-chat-compose .amb-reply")!.requestSubmit());
  expect(acts).toEqual([{ kind: "reply", botId: "Ada", threadId: "t-Ada", text: "Thanks, file it under taxes" }]);
  // the field is ready for the next message
  expect(input.value).toBe("");
  await unmount();
});

it("forgives a slip of the pointer: off the bots and straight back, the card stays", async () => {
  const { host, hover, unmount } = await mount([bot("Ada", { chat: [{ id: "m1", from: "bot", text: "Hi", at: 1 }] })]);
  await hover("Ada");
  await wait(DWELL_MS + 60);
  const card = host.querySelector(".amb-card")!;
  await act(async () => host.querySelector(".amb-dock-list")!.dispatchEvent(new PointerEvent("pointerout", { bubbles: true })));
  await wait(CARD_LEAVE_MS / 3);
  await hover("Ada");
  await wait(CARD_LEAVE_MS + 40);
  expect(card.getAttribute("data-card")).toBe("Ada");
  await unmount();
});

it("opens the app only from a bot's mascot: never from the card's words, messages or name", async () => {
  const { host, cell, opened, hover, unmount } = await mount([bot("Ada", { chat: [{ id: "m1", from: "bot", text: "Paid on Saturday.", at: 1 }] })]);
  await hover("Ada");
  await wait(DWELL_MS + 60);
  const card = host.querySelector(".amb-card")!;
  await act(async () => card.querySelector<HTMLElement>(".amb-chat-list")!.click());
  await act(async () => card.querySelector<HTMLElement>(".amb-bubble-msg")!.click());
  await act(async () => card.querySelector<HTMLElement>(".amb-chat-head .amb-row-name")!.click());
  await act(async () => card.querySelector<HTMLElement>(".amb-chat-compose .amb-reply-input")!.click());
  expect(opened).toEqual([]);
  await act(async () => card.querySelector<HTMLButtonElement>(".amb-chat-mascot")!.click());
  await act(async () => cell("Ada").querySelector<HTMLButtonElement>(".amb-dock-bot")!.click());
  expect(opened).toEqual(["Ada", "Ada"]);
  await unmount();
});

it("on the way out the card goes almost at once, and the column only a good while later, then main is told", async () => {
  const { host, settledCount, hover, unmount } = await mount([bot("Ada", { chat: [{ id: "m1", from: "bot", text: "Hi", at: 1 }] })]);
  await hover("Ada");
  await wait(DWELL_MS + 60);
  const card = host.querySelector(".amb-card")!;
  const dock = host.querySelector(".amb-dock")!;
  const before = settledCount();
  await act(async () => host.querySelector(".amb-dock-list")!.dispatchEvent(new PointerEvent("pointerout", { bubbles: true })));
  await act(async () => { document.dispatchEvent(new MouseEvent("mousemove", { clientX: 5000, clientY: 5000 })); });
  await wait(CARD_LEAVE_MS + 40);
  expect(card.getAttribute("data-card")).toBeNull();
  expect(dock.hasAttribute("data-hidden")).toBe(false);
  await wait(HIDE_MS - CARD_LEAVE_MS);
  expect(dock.hasAttribute("data-hidden")).toBe(true);
  expect(settledCount()).toBe(before);
  await wait(SETTLED_MS + 80);
  expect(settledCount()).toBeGreaterThan(before);
  await unmount();
});

it("shows nothing at all with no bots, and every bot once they come", async () => {
  const { host, unmount } = await mount([]);
  expect(host.querySelector(".amb-stage")?.hasAttribute("data-empty")).toBe(true);
  expect(host.querySelectorAll("[data-row]")).toHaveLength(0);
  await unmount();
});

it("while main traces, says when the pointer crosses, the column and the card come and go, and it has settled", async () => {
  let feed: (snapshot: AmbientSnapshot) => void = () => {};
  const events: string[] = [];
  const bridge: AmbientBridge = {
    surface: "dock", onState: (cb) => { feed = cb; return () => {}; }, onLayout: () => () => {}, pointer() {}, open() {}, act() {}, order() {}, ready() {},
    settled() {}, trace: (event) => events.push(event),
  };
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  await act(async () => root.render(createElement(Dock, { bridge })));
  await act(async () => feed({ lang: "en", labels: {}, bots: [bot("Ada", { chat: [{ id: "m1", from: "bot", text: "Hi", at: 1 }] })] }));
  await arrive();
  await act(async () => {
    host.querySelector('[data-row="Ada"]')!.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
    document.dispatchEvent(new MouseEvent("mousemove", { clientX: 400, clientY: 360 }));
  });
  await wait(DWELL_MS + 60);
  await act(async () => { document.dispatchEvent(new MouseEvent("mousemove", { clientX: 5000, clientY: 5000 })); });
  // in steps, as it happens: React holds a test's updates until each step ends
  await wait(CARD_LEAVE_MS + 40);
  await wait(HIDE_MS - CARD_LEAVE_MS);
  await wait(SETTLED_MS + 80);
  const seen = (name: string) => events.indexOf(name);
  for (const name of ["page-ready", "pointer-enter", "state-column-out", "state-card", "pointer-leave", "state-card-closing", "state-column-closing", "settled-signal"]) expect(seen(name), name).toBeGreaterThanOrEqual(0);
  expect(seen("pointer-leave")).toBeLessThan(seen("state-card-closing"));
  expect(seen("state-card-closing")).toBeLessThan(seen("state-column-closing"));
  expect(seen("state-column-closing")).toBeLessThan(seen("settled-signal"));
  await act(async () => root.unmount());
});

it("chats for real: the card asks for a long stretch of the bot it shows, shows a sent message at once, and the reply as it streams", async () => {
  let feed: (snapshot: AmbientSnapshot) => void = () => {};
  const acts: AmbientAct[] = [];
  const viewing: unknown[] = [];
  const bridge: AmbientBridge = {
    surface: "dock", onState: (cb) => { feed = cb; return () => {}; }, onLayout: () => () => {}, pointer() {}, open() {}, act: (next) => acts.push(next), order() {}, ready() {},
    viewing: (next) => viewing.push(next),
  };
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  await act(async () => root.render(createElement(Dock, { bridge })));
  const ada = (fields: Partial<AmbientBot> = {}) => bot("Ada", { chat: [{ id: "m1", from: "bot", text: "Paid on Saturday.", at: 1 }], ...fields });
  await act(async () => feed({ lang: "en", labels: LABELS, bots: [ada()] }));
  await arrive();
  await act(async () => {
    host.querySelector('[data-row="Ada"]')!.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
    document.dispatchEvent(new MouseEvent("mousemove", { clientX: 400, clientY: 360 }));
  });
  await wait(DWELL_MS + 60);
  expect(viewing.at(-1)).toEqual({ botId: "Ada", limit: HISTORY });
  const card = host.querySelector(".amb-card")!;
  const input = card.querySelector<HTMLInputElement>(".amb-chat-compose .amb-reply-input")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "and the next one?");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => card.querySelector<HTMLFormElement>(".amb-chat-compose .amb-reply")!.requestSubmit());
  // there at once, before the chat's own copy comes back
  expect(card.querySelector(".amb-bubble-msg[data-pending]")?.textContent).toBe("and the next one?");
  expect(acts.at(-1)).toMatchObject({ kind: "reply", botId: "Ada", text: "and the next one?" });
  // the chat's copy arrives, the bot works, then writes
  await act(async () => feed({ lang: "en", labels: LABELS, bots: [ada({ status: "working", chat: [{ id: "m1", from: "bot", text: "Paid on Saturday.", at: 1 }, { id: "m2", from: "you", text: "and the next one?", at: Date.now() }] })] }));
  expect(card.querySelector(".amb-bubble-msg[data-pending]")).toBeNull();
  expect(card.querySelector(".amb-typing")).not.toBeNull();
  await act(async () => feed({ lang: "en", labels: LABELS, bots: [ada({ status: "talking", streaming: "The next one is due", chat: [{ id: "m1", from: "bot", text: "Paid on Saturday.", at: 1 }, { id: "m2", from: "you", text: "and the next one?", at: Date.now() }] })] }));
  expect(card.querySelector(".amb-bubble-msg[data-streaming]")?.textContent).toBe("The next one is due");
  expect(card.querySelector(".amb-typing")).toBeNull();
  // gone from the card: nothing viewed
  await act(async () => { document.dispatchEvent(new MouseEvent("mousemove", { clientX: 5000, clientY: 5000 })); });
  await wait(CARD_LEAVE_MS + 60);
  expect(viewing.at(-1)).toBeNull();
  await act(async () => root.unmount());
});

it("comes out only on purpose: not for a pointer that slides along the edge or drags, but for a rest there or a click", async () => {
  const { host, opened, unmount } = await mount([bot("Ada", {})]);
  const hidden = () => host.querySelector(".amb-dock")!.hasAttribute("data-hidden");
  const move = (x: number, y: number, buttons = 0) => act(async () => { document.dispatchEvent(new MouseEvent("mousemove", { clientX: x, clientY: y, buttons })); });
  // dragging something to the edge
  await move(100, 360);
  await move(400, 360, 1);
  await wait(REVEAL.dwellMs + 60);
  expect(hidden()).toBe(true);
  // sliding along it (happy-dom lays nothing out, so the zone beside the empty body is only the ears' height)
  await move(100, 360);
  for (const y of [344, 356, 368, 356, 344, 356, 368]) { await move(400, y); await wait(120); }
  expect(hidden()).toBe(true);
  // then resting
  await wait(REVEAL.dwellMs + 40);
  expect(hidden()).toBe(false);
  await move(5000, 5000);
  await wait(HIDE_MS + 60);
  expect(hidden()).toBe(true);
  // a click on the sliver: out at once, and the hidden mascot under it is not clicked
  await move(100, 360);
  await move(400, 360);
  const target = host.querySelector<HTMLElement>('[data-row="Ada"] .amb-dock-bot')!;
  await act(async () => {
    target.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    target.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  expect(hidden()).toBe(false);
  expect(opened).toEqual([]);
  await unmount();
});

it("comes out for a rest at the edge even when the panel takes focus as the pointer arrives, and a window switch elsewhere still holds it back", async () => {
  const { host, unmount } = await mount([bot("Ada", {})]);
  const hidden = () => host.querySelector(".amb-dock")!.hasAttribute("data-hidden");
  const move = (x: number, y: number) => act(async () => { document.dispatchEvent(new MouseEvent("mousemove", { clientX: x, clientY: y })); });
  // the pointer reaches the edge, the panel gets focus right after, and the pointer rests without another move
  await move(100, 360);
  await move(400, 360);
  await act(async () => { window.dispatchEvent(new FocusEvent("focus")); });
  await wait(REVEAL.dwellMs + 40);
  expect(hidden()).toBe(false);
  await move(5000, 5000);
  await wait(HIDE_MS + 60);
  expect(hidden()).toBe(true);
  // focus arriving while the pointer is elsewhere: a window switch, so reaching the edge just then opens nothing yet
  await move(100, 360);
  await act(async () => { window.dispatchEvent(new FocusEvent("focus")); });
  await move(400, 360);
  await wait(REVEAL.dwellMs + 40);
  expect(hidden()).toBe(true);
  await unmount();
});

it("takes clicks only where it is drawn: the edge zone and the grace around the column still open and keep it, but clicks there reach the app underneath", async () => {
  let feed: (snapshot: AmbientSnapshot) => void = () => {};
  const pointer: boolean[] = [];
  const bridge: AmbientBridge = {
    surface: "dock", onState: (cb) => { feed = cb; return () => {}; }, onLayout: () => () => {}, pointer: (on) => pointer.push(on), open() {}, act() {}, order() {}, ready() {},
    onSeen: () => () => {}, seen() {}, settled() {},
  };
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  await act(async () => root.render(createElement(Dock, { bridge })));
  await act(async () => feed({ lang: "en", labels: LABELS, bots: [bot("Ada", {})] }));
  const hidden = () => host.querySelector(".amb-dock")!.hasAttribute("data-hidden");
  const move = (x: number, y: number) => act(async () => { document.dispatchEvent(new MouseEvent("mousemove", { clientX: x, clientY: y })); });
  const solid = () => pointer.at(-1) === true;
  // the stage is 408 wide with the screen's edge at 404: the sliver is the last 6px, the edge zone the last 14
  await move(100, 360);
  await move(394, 360);
  expect(solid()).toBe(false);
  await wait(REVEAL.dwellMs + 40);
  expect(hidden()).toBe(false);
  expect(solid()).toBe(false);
  // out, the column (340 to 404) takes clicks; the grace left of it keeps it out but lets clicks through
  await move(350, 360);
  expect(solid()).toBe(true);
  await move(330, 360);
  expect(solid()).toBe(false);
  await wait(HIDE_MS + 60);
  expect(hidden()).toBe(false);
  // gone past the grace, it goes away; the sliver itself still takes a click
  await move(5000, 5000);
  await wait(HIDE_MS + 60);
  expect(hidden()).toBe(true);
  await move(100, 360);
  await move(400, 360);
  expect(solid()).toBe(true);
  await act(async () => root.unmount());
});
