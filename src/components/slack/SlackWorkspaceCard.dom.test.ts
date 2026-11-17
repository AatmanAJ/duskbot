// @vitest-environment happy-dom
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/state/api";
import { setLocale } from "@/lib/i18n";
import type { SlackWorkspaceStatus } from "../../../shared/slack.ts";

const fixture = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("@/state/store", async () => (await import("@/testing/store-mock")).withStoreHooks(await (() => ({ api: fixture.api }))()));
const { SlackWorkspaceCard } = await import("./SlackWorkspaceCard");
let host: HTMLDivElement;
let root: Root;
let status: SlackWorkspaceStatus;
const settle = async () => { for (let i = 0; i < 4; i++) await new Promise((resolve) => setTimeout(resolve, 0)); };
const mount = async () => { flushSync(() => root.render(createElement(SlackWorkspaceCard))); await settle(); };
const button = (text: string) => [...host.querySelectorAll("button")].find((item) => item.textContent === text)!;
const click = async (text: string) => { flushSync(() => button(text).click()); await settle(); };
const write = (label: string, value: string) => {
  const input = host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
  flushSync(() => input.dispatchEvent(new Event("input", { bubbles: true })));
};

beforeEach(() => {
  setLocale("en");
  status = { version: 1, ready: true, state: "not_connected", apps: 0 };
  fixture.api.mockReset();
  fixture.api.mockImplementation(async (_path: string, init?: RequestInit) => {
    if (init?.method === "PUT") status = { ...status, state: "connected", teamName: "Acme", apps: 2 };
    if (init?.method === "DELETE") status = { ...status, state: "not_connected", apps: 0 };
    return status;
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => { flushSync(() => root.unmount()); host.remove(); });

describe("Slack workspace setup", () => {
  it("opens three inline steps and keeps Connect off until both tokens are filled", async () => {
    await mount();
    expect(host.textContent).toContain("Each bot joins Slack as its own app");
    expect(host.querySelector("input")).toBeNull();
    await click("Connect");
    const link = host.querySelector("a")!;
    expect(link.textContent).toBe("1. Open your apps on Slack");
    expect(link.getAttribute("href")).toBe("https://api.slack.com/apps");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    expect(host.textContent).toContain("2. Under your app configuration tokens");
    expect(host.textContent).toContain("3. Copy both tokens");
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(button("Connect").disabled).toBe(true);
    write("Access token", "fixture-access");
    expect(button("Connect").disabled).toBe(true);
    write("Refresh token", "fixture-refresh");
    expect(button("Connect").disabled).toBe(false);
    for (const input of host.querySelectorAll("input")) {
      expect(input.type).toBe("password");
      expect(input.autocomplete).toBe("off");
      expect(input.getAttribute("spellcheck")).toBe("false");
      expect(input.dir).toBe("ltr");
    }
    await click("Connect");
    expect(fixture.api).toHaveBeenCalledWith("/api/slack/workspace", { method: "PUT", body: JSON.stringify({ accessToken: "fixture-access", refreshToken: "fixture-refresh" }) });
    expect(host.textContent).toContain("Connected to Acme");
    expect(host.textContent).toContain("2 bots");
    expect(host.querySelector("input")).toBeNull();
    expect(host.innerHTML).not.toContain("fixture-access");
    await click("Disconnect");
    expect(fixture.api).toHaveBeenCalledWith("/api/slack/workspace", { method: "DELETE" });
    await click("Connect");
    expect([...host.querySelectorAll("input")].map((input) => input.value)).toEqual(["", ""]);
  });

  it("clears both drafts on Cancel", async () => {
    await mount();
    await click("Connect");
    write("Access token", "fixture-access");
    write("Refresh token", "fixture-refresh");
    await click("Cancel");
    await click("Connect");
    expect([...host.querySelectorAll("input")].map((input) => input.value)).toEqual(["", ""]);
  });

  it("shows the connected team, count, Disconnect and where to add a bot", async () => {
    status = { ...status, state: "connected", teamName: "Acme", apps: 3 };
    await mount();
    expect(host.textContent).toContain("Connected to Acme");
    expect(host.textContent).toContain("3 bots");
    expect(button("Disconnect")).toBeTruthy();
    expect(host.textContent).toContain("advanced, Slack");
  });

  it("opens the same setup when the workspace needs reconnecting", async () => {
    status.state = "needs_reconnect";
    await mount();
    expect(host.textContent).toContain("Slack stopped accepting the Slack workspace token");
    await click("Reconnect");
    expect(host.querySelectorAll("input")).toHaveLength(2);
  });

  it("says Slack is not available, rather than loading for ever, while the secret store is not ready", async () => {
    status.ready = false;
    await mount();
    expect(host.textContent).toContain("Slack isn't available on this computer right now.");
    expect(host.textContent).not.toContain("Loading Slack settings…");
    expect(host.querySelector("button")).toBeNull();
  });

  it("renders nothing on an older server", async () => {
    fixture.api.mockRejectedValue(new ApiError("Not found", 404));
    await mount();
    expect(host.innerHTML).toBe("");
  });

  it("shows a server error and uses friendly copy for an unknown failure", async () => {
    await mount();
    await click("Connect");
    write("Access token", "fixture-access");
    write("Refresh token", "fixture-refresh");
    fixture.api.mockRejectedValueOnce(new ApiError("Refused", 422, { error: "Workspace token expired" }));
    await click("Connect");
    expect(host.querySelector('[role="alert"]')?.textContent).toBe("Workspace token expired");
    fixture.api.mockRejectedValueOnce(new Error("private diagnostic"));
    await click("Connect");
    expect(host.querySelector('[role="alert"]')?.textContent).toBe("Could not update Slack. Try again.");
    expect(host.textContent).not.toContain("private diagnostic");
  });
});
