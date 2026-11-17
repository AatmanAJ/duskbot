import { describe, expect, it } from "vitest";
import type { Message } from "@/state/store";
import { friendlyNowPhrases, poolWords, startsAnywhere, toolService } from "./friendly-activity";

const running = (name: string, extra: Partial<NonNullable<Message["tool"]>> = {}): Message =>
  ({ id: "m", role: "bot", kind: "activity", at: 1, tool: { name, ...extra } });

describe("Simple mode's working line", () => {
  it("says something playful while nothing is reported, from one big pool that starts anywhere", () => {
    const generic = friendlyNowPhrases(null);
    expect(generic.phase).toBe("friendly:generic");
    expect(generic.phrases.length).toBeGreaterThanOrEqual(25);
    expect(generic.phrases).toEqual(expect.arrayContaining(["Cooking", "Locking in", "Big brain time", "Stargazing"]));
    expect(friendlyNowPhrases({ activity: "thinking" })).toEqual({ phase: "friendly:thinking", phrases: generic.phrases });
    expect(startsAnywhere(generic.phase) && startsAnywhere("friendly:thinking")).toBe(true);
    expect(startsAnywhere("friendly:commands"), "a step leads with what it is").toBe(false);
  });

  it("keeps every word short, Sentence case, with no dots, emoji or machine talk", () => {
    const pools = ["thinking", "generic", "typing", "digging", "web", "page", "code", "commands", "clicking", "team"] as const;
    for (const word of pools.flatMap((name) => poolWords(name))) {
      expect(word.split(" ").length, word).toBeLessThanOrEqual(5);
      expect(word, "sentence case").toMatch(/^[A-Z][^A-Z]*$/);
      expect(word).not.toMatch(/\.$|\p{Extended_Pictographic}|\bAI\b|processing|loading/iu);
    }
  });

  it("puts a step's own words first: a kind of work is never the generic pool", () => {
    const generic = new Set(poolWords("generic"));
    for (const shown of [
      friendlyNowPhrases({ activity: "command", itemId: "x", target: "scrape.py" }),
      friendlyNowPhrases({ activity: "web", itemId: "s", target: "standing desks" }),
      friendlyNowPhrases({ activity: "fetch", itemId: "f", target: "linkedin.com" }),
      friendlyNowPhrases({ activity: "write", file: "index.html", itemId: "w" }),
    ]) {
      expect(shown.phase).not.toBe("friendly:generic");
      expect(generic.has(shown.phrases[0]!), shown.phrases[0]).toBe(false);
    }
  });

  it("names the kind of work in plain words, never a file name or size", () => {
    const lead = (shown: { phrases: string[] }) => shown.phrases[0];
    expect(friendlyNowPhrases({ activity: "reply" })).toEqual({ phase: "friendly:chat.typing", phrases: ["Typing…", "Writing", "Wordsmithing", "Typing it up", "Plating it", "Finishing touches", "Wrapping up"] });
    expect(lead(friendlyNowPhrases({ activity: "command", itemId: "x" }))).toBe("Running a few commands");
    expect(lead(friendlyNowPhrases({ activity: "write", file: "index.html", bytes: 14_000, itemId: "w" }))).toBe("Writing some code");
    expect(lead(friendlyNowPhrases({ activity: "read", file: "notes.md", itemId: "r" }))).toBe("Digging around");
    expect(friendlyNowPhrases({ activity: "web", itemId: "s" }).phrases).toEqual(["Digging around", "Digging", "Snooping around", "Scouting", "Combing the web"]);
    expect(friendlyNowPhrases({ activity: "fetch", itemId: "f" }).phrases).toEqual(["Digging around", "Skimming", "Speed-reading"]);
    expect(lead(friendlyNowPhrases(null, running("Bash")))).toBe("Running a few commands");
    expect(friendlyNowPhrases(null, running("mcp__computer__click")).phrases).toEqual(["Clicking around", "Driving the mouse"]);
    expect(friendlyNowPhrases(null, running("delegate_bot")).phrases).toEqual(["Checking in with the team", "Looping in a teammate"]);
  });

  it("reads a step by its tool, not the narration the server writes for calls", () => {
    expect(friendlyNowPhrases(null, running("Bash", { spoken: "Running a command" })).phrases[0]).toBe("Running a few commands");
  });

  it("never says the command, search or address itself, as grok's line does not", () => {
    const said = [
      friendlyNowPhrases({ activity: "command", itemId: "x", target: "scrape.py" }),
      friendlyNowPhrases({ activity: "web", itemId: "s", target: "Acme construction leads" }),
      friendlyNowPhrases(null, running("WebFetch", { step: { activity: "fetch", target: "linkedin.com" } })),
      friendlyNowPhrases(null, running("Write", { step: { activity: "write", target: "report.md" } })),
    ].flatMap((shown) => shown.phrases).join("|");
    expect(said).not.toMatch(/scrape\.py|Acme|linkedin|report\.md/);
  });

  it("says which outside service the bot is working in", () => {
    expect(toolService("mcp__notion__search")).toBe("Notion");
    expect(toolService("mcp__composio__GMAIL_SEND_EMAIL")).toBe("Gmail");
    expect(toolService("mcp__dusk__ask_user")).toBeNull();
    expect(toolService("Bash")).toBeNull();
    expect(friendlyNowPhrases(null, running("mcp__notion__search")).phrases).toEqual(["Working in Notion"]);
  });
});
