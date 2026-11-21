import { describe, expect, it } from "vitest";

import { browserRefusal } from "../browser-refusals.ts";
import { CarriedRefs, carriedRefMissing, refsOf, translateRefs } from "./agent-browser-refs.ts";

/** agent-browser 0.37's snapshot answer, shaped as its MCP server returns it. */
function snapshot(lines: Array<[string, string, string]>) {
  const text = lines.map(([ref, role, name]) => `- ${role} ${JSON.stringify(name)} [ref=${ref}]`).join("\n");
  const refs = Object.fromEntries(lines.map(([ref, role, name]) => [ref, { role, name }]));
  return { content: [{ type: "text", text }], structuredContent: { response: { success: true, data: { refs, snapshot: text } } } };
}

const click = (selector: string) => ({ name: "agent_browser_click", arguments: { selector } });

describe("a conversation's refs across a tab switch that cleared them", () => {
  it("reads refs from a snapshot's data, or from the page text an open answers with", () => {
    expect([...refsOf(snapshot([["e2", "textbox", "Message"], ["e1", "link", "Creator A"]]))!.keys()]).toEqual(["e1", "e2"]);
    const opened = { content: [{ type: "text", text: "Navigated" }, { type: "text", text: '- link "Say \\"hi\\"" [ref=e1]\n  - textbox "Message" [ref=e3]: draft' }] };
    expect([...refsOf(opened)!]).toEqual([["e1", { role: "link", name: 'Say "hi"' }], ["e3", { role: "textbox", name: "Message" }]]);
    expect(refsOf({ isError: true, content: [] })).toBeNull();
  });

  it("maps each old ref to the element with its role and name at the same place, only where the counts agree", () => {
    const old = refsOf(snapshot([["e1", "button", "Delete"], ["e2", "button", "Delete"], ["e3", "textbox", "Message"], ["e4", "link", "Home"]]))!;
    const fresh = refsOf(snapshot([["e1", "link", "Home"], ["e2", "button", "Delete"], ["e3", "textbox", "Message"]]))!;
    expect(Object.fromEntries(translateRefs(old, fresh))).toEqual({ e3: "e3", e4: "e1" });
  });

  it("leaves calls alone until a switch, then rewrites old refs and refuses ones with no single match", async () => {
    const refs = new CarriedRefs();
    refs.saw("s", "a", "agent_browser_snapshot", { interactive: true }, snapshot([["e1", "link", "Creator A"], ["e2", "button", "Send"], ["e3", "textbox", "Message"]]));
    expect(refs.carry("s", "a", click("@e3"))).toEqual(click("@e3"));
    const asked: unknown[] = [];
    await refs.restore("s", "a", async (args) => {
      asked.push(args);
      return snapshot([["e1", "textbox", "Message"], ["e2", "link", "Creator A"], ["e3", "button", "Send"], ["e4", "button", "Send"]]);
    });
    expect(asked).toEqual([{ interactive: true }]);
    expect(refs.carry("s", "a", click("@e3"))).toEqual(click("@e1"));
    expect(refs.carry("s", "a", click("e1"))).toEqual(click("@e2"));
    expect(refs.carry("s", "a", click("#send"))).toEqual(click("#send"));
    let refused: unknown;
    try { refs.carry("s", "a", click("@e2")); } catch (error) { refused = error; }
    expect(browserRefusal(refused)).toBe(carriedRefMissing("e2"));
    expect(refs.carry("s", "b", click("@e2"))).toEqual(click("@e2"));
  });

  it("stops carrying once the conversation reads the page again, and forgets refs a page change ends", async () => {
    const refs = new CarriedRefs();
    const first = snapshot([["e1", "textbox", "Message"]]);
    refs.saw("s", "a", "agent_browser_open", { url: "https://example.com/" }, { content: [{ type: "text", text: '- textbox "Message" [ref=e1]' }] });
    const asked: unknown[] = [];
    await refs.restore("s", "a", async (args) => { asked.push(args); return snapshot([["e7", "textbox", "Message"]]); });
    expect(asked).toEqual([{ compact: true }]);
    expect(refs.carry("s", "a", click("@e1"))).toEqual(click("@e7"));
    refs.saw("s", "a", "agent_browser_snapshot", {}, first);
    expect(refs.carry("s", "a", click("@e7"))).toEqual(click("@e7"));
    refs.saw("s", "a", "agent_browser_reload", {}, { content: [] });
    await refs.restore("s", "a", async () => { throw new Error("no snapshot to take again"); });
    expect(refs.carry("s", "a", click("@e1"))).toEqual(click("@e1"));
  });
});
