import { describe, expect, it } from "vitest";

import { agentBrowserTypeInLines, linesToType, runAgentBrowserTypeInLines, typeWithLineBreaks, typesLineBreaks } from "./line-break-typing.ts";
import { localComputerRelay } from "./local-computer-guidance.ts";
import type { ChildCalls } from "./mcp-bridge.ts";

const BRIEF = "VERSINE Creator Brief\nhttps://versine.com/\n\nWHAT IT IS\r\nVenmo for agents.";

describe("linesToType", () => {
  it("splits at every kind of line break and keeps empty lines", () => {
    expect(linesToType(BRIEF)).toEqual(["VERSINE Creator Brief", "https://versine.com/", "", "WHAT IT IS", "Venmo for agents."]);
    expect(linesToType("a\rb")).toEqual(["a", "b"]);
  });

  it("leaves a single line, and a line break only at the end, as they came", () => {
    expect(linesToType("hello")).toBeNull();
    expect(linesToType("hello\n")).toBeNull();
    expect(linesToType("a\nb\n")).toEqual(["a", "b\n"]);
  });
});

function driver(answer: (name: string, args: Record<string, unknown>) => Record<string, unknown> = () => ({ content: [{ type: "text", text: "ok" }] })) {
  const calls: Array<[string, Record<string, unknown>]> = [];
  const call = async (name: string, args: Record<string, unknown>) => { calls.push([name, args]); return answer(name, args); };
  return { calls, call };
}

describe("typeWithLineBreaks", () => {
  it("types each line and puts a Shift+Return between lines, never a bare Return", async () => {
    const { calls, call } = driver();
    const answer = await typeWithLineBreaks(call, (args) => call("type_text", args), { pid: 7, window_id: 3, element_index: 12, text: BRIEF });
    expect(calls).toEqual([
      ["type_text", { pid: 7, window_id: 3, element_index: 12, text: "VERSINE Creator Brief" }],
      ["press_key", { pid: 7, window_id: 3, key: "return", modifiers: ["shift"] }],
      ["type_text", { pid: 7, window_id: 3, text: "https://versine.com/" }],
      ["press_key", { pid: 7, window_id: 3, key: "return", modifiers: ["shift"] }],
      ["press_key", { pid: 7, window_id: 3, key: "return", modifiers: ["shift"] }],
      ["type_text", { pid: 7, window_id: 3, text: "WHAT IT IS" }],
      ["press_key", { pid: 7, window_id: 3, key: "return", modifiers: ["shift"] }],
      ["type_text", { pid: 7, window_id: 3, text: "Venmo for agents." }],
    ]);
    expect(calls.some(([, args]) => typeof args.text === "string" && /[\r\n]/u.test(args.text))).toBe(false);
    expect(answer).toMatchObject({ content: [{ type: "text", text: expect.stringMatching(/^Typed 5 lines as one draft, each line break as Shift\+Return\. Nothing was sent/) }] });
  });

  it("focuses with the first call only, and with a press when the text starts with a line break", async () => {
    const { calls, call } = driver();
    await typeWithLineBreaks(call, (args) => call("type_text", args), { pid: 7, x: 40, y: 50, delivery_mode: "background", text: "\nhi" });
    expect(calls).toEqual([
      ["press_key", { pid: 7, x: 40, y: 50, delivery_mode: "background", key: "return", modifiers: ["shift"] }],
      ["type_text", { pid: 7, delivery_mode: "background", text: "hi" }],
    ]);
  });

  it("says a trailing line break was typed as Return", async () => {
    const { calls, call } = driver();
    const answer = await typeWithLineBreaks(call, (args) => call("type_text", args), { scope: "desktop", text: "a\nb\n" });
    expect(calls.at(-1)).toEqual(["type_text", { scope: "desktop", text: "b\n" }]);
    expect(answer).toMatchObject({ content: [{ text: expect.stringContaining("typed as Return") }] });
  });

  it("stops at the first failure and says how much went in, without telling the bot to retype it all", async () => {
    const { calls, call } = driver((name, args) => (name === "type_text" && args.text === "WHAT IT IS"
      ? { content: [{ type: "text", text: "window gone" }], isError: true } : { content: [] }));
    const answer = await typeWithLineBreaks(call, (args) => call("type_text", args), { pid: 7, window_id: 3, text: BRIEF });
    expect(calls.filter(([name]) => name === "type_text").map(([, args]) => args.text)).toEqual(["VERSINE Creator Brief", "https://versine.com/", "WHAT IT IS"]);
    expect(answer).toMatchObject({ isError: true, content: [{ text: expect.stringMatching(/^Only 3 of 5 lines went in .*never type the whole text again/) }, { text: "window gone" }] });
  });
});

describe("localComputerRelay with line breaks", () => {
  const child = (driverVersion = "0.40.0") => {
    const { calls, call } = driver((name) => (name === "bring_to_front" ? { content: [], structuredContent: { previous_fg_hwnd: "0x3", target_hwnd: "0x3" } } : { content: [] }));
    return { calls, relayed: { driverVersion, call } satisfies ChildCalls };
  };

  it("types multi-line text with Shift+Return on every platform, and leaves single-line text to the driver", async () => {
    for (const platform of ["darwin", "linux", "win32"]) {
      const { calls, relayed } = child();
      await localComputerRelay(platform)({ name: "type_text", arguments: { pid: 7, window_id: 3, text: "a\nb" } }, relayed);
      expect(calls.map(([name, args]) => [name, args.text ?? args.modifiers])).toEqual([["type_text", "a"], ["press_key", ["shift"]], ["type_text", "b"]]);
      expect(localComputerRelay(platform)({ name: "type_text", arguments: { pid: 7, window_id: 3, text: "ab" } }, relayed)).toBeNull();
      expect(typesLineBreaks("type_text", { text: "ab\n" })).toBe(false);
    }
  });

  it("on Windows with a driver that types in one burst, paces each line and keeps the Shift+Return between", async () => {
    const { calls, relayed } = child("0.28.2");
    await localComputerRelay("win32")({ name: "type_text", arguments: { pid: 7, window_id: 3, delivery_mode: "foreground", text: "ab\nc" } }, relayed);
    expect(calls.filter(([name]) => name !== "bring_to_front" && name !== "list_windows").map(([name, args]) => [name, args.text ?? args.modifiers]))
      .toEqual([["type_text", "a"], ["type_text", "b"], ["press_key", ["shift"]], ["type_text", "c"]]);
  });
});

describe("agent_browser_type with line breaks", () => {
  it("types each line into the same field with Shift+Enter between, clearing only before the first", () => {
    expect(agentBrowserTypeInLines("agent_browser_type", { selector: "@e4", clear: true, text: "Hi\n\nthere" })?.calls).toEqual([
      { name: "agent_browser_type", arguments: { selector: "@e4", clear: true, text: "Hi" }, line: 0 },
      { name: "agent_browser_press", arguments: { key: "Shift+Enter" }, line: 1 },
      { name: "agent_browser_press", arguments: { key: "Shift+Enter" }, line: 2 },
      { name: "agent_browser_type", arguments: { selector: "@e4", text: "there" }, line: 2 },
    ]);
    expect(agentBrowserTypeInLines("agent_browser_type", { selector: "@e4", text: "one line\n" })).toBeNull();
    expect(agentBrowserTypeInLines("agent_browser_fill", { selector: "@e4", text: "a\nb" })).toBeNull();
  });

  it("answers as one call, and on a failure says how many lines went in", async () => {
    const planned = agentBrowserTypeInLines("agent_browser_type", { selector: "@e4", text: "a\nb\nc" })!;
    const ok = await runAgentBrowserTypeInLines(planned, async () => ({ content: [{ type: "text", text: "done" }] }));
    expect(ok).toMatchObject({ content: [{ text: expect.stringMatching(/^Typed 3 lines as one draft, each line break as Shift\+Enter\. Nothing was sent/) }, { text: "done" }] });
    const seen: string[] = [];
    const failed = await runAgentBrowserTypeInLines(planned, async (step) => {
      seen.push(step.name);
      return step.name === "agent_browser_type" && step.arguments.text === "c" ? { isError: true, content: [{ type: "text", text: "detached" }] } : { content: [] };
    });
    expect(seen).toEqual(["agent_browser_type", "agent_browser_press", "agent_browser_type", "agent_browser_press", "agent_browser_type"]);
    expect(failed).toMatchObject({ isError: true, content: [{ text: expect.stringMatching(/^Only 2 of 3 lines went in/) }, { text: "detached" }] });
  });
});
