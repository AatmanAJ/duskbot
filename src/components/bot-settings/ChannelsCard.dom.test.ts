// @vitest-environment happy-dom
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";
import type { Bot } from "@/state/store";
import type { MessengerStatus } from "../../../shared/messengers";

const fixture = vi.hoisted(() => ({ calls: [] as Array<{ path: string; method: string; body?: unknown }>, telegram: null as unknown }));
vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return {
    ...original,
    api: async (path: string, init?: { method?: string; body?: string }) => {
      const method = init?.method ?? "GET";
      fixture.calls.push({ path, method, ...(init?.body ? { body: JSON.parse(init.body) } : {}) });
      if (method === "GET") return { botId: "b1", platforms: [fixture.telegram, { platform: "discord", state: "not_connected", allowed: [], knocked: [] }] };
      return fixture.telegram;
    },
  };
});
const { ChannelsCard } = await import("./ChannelsCard");

let host: HTMLDivElement;
let root: Root;
const settle = async () => { for (let i = 0; i < 4; i++) await new Promise((resolve) => setTimeout(resolve, 0)); };
const find = (id: string) => host.querySelector<HTMLElement>(`[data-testid="${id}"]`)!;

beforeEach(() => {
  setLocale("en");
  fixture.calls = [];
  fixture.telegram = { platform: "telegram", state: "not_connected", allowed: [], knocked: [] } satisfies MessengerStatus;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => { flushSync(() => root.unmount()); host.remove(); });

describe("the Channels card", () => {
  it("connects Telegram from a pasted token, then shows the claim link and lets a turned-away person in", async () => {
    flushSync(() => root.render(createElement(ChannelsCard, { bot: { id: "b1", name: "Nova" } as Bot })));
    await settle();
    expect(find("channels").textContent).toContain("Channels");
    const input = find("channels-telegram").querySelector("input")!;
    expect(input.type).toBe("password");
    expect(find("channels-telegram").querySelector("label")!.textContent).toBe("Telegram bot token");
    fixture.telegram = {
      platform: "telegram", state: "online", handle: "@nova_bot", openUrl: "https://t.me/nova_bot", pairUrl: "https://t.me/nova_bot?start=ABCD2345", pairCode: "ABCD2345",
      allowed: [], knocked: [{ id: "777", kind: "person", name: "Mallory", at: 1 }],
    } satisfies MessengerStatus;
    flushSync(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "7000001:AAH" + "x".repeat(32));
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    flushSync(() => find("channels-telegram").querySelector("form")!.requestSubmit());
    await settle();
    expect(fixture.calls.at(-1)).toEqual({ path: "/api/bots/b1/messengers/telegram", method: "PUT", body: { token: "7000001:AAH" + "x".repeat(32) } });
    const row = find("channels-telegram");
    expect(row.textContent).toContain("Telegram · @nova_bot");
    expect(row.textContent).toContain("Working");
    expect(row.querySelector('a[href="https://t.me/nova_bot?start=ABCD2345"]')!.textContent).toBe("Open in Telegram");
    expect(row.textContent).not.toContain("start=ABCD2345");
    const letIn = [...row.querySelectorAll("button")].find((button) => button.textContent === "Let in")!;
    flushSync(() => letIn.click());
    await settle();
    expect(fixture.calls.at(-1)).toEqual({ path: "/api/bots/b1/messengers/telegram/allowed", method: "POST", body: { id: "777" } });
  });
});
