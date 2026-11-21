import { describe, expect, it } from "vitest";
import { CASES, type Case } from "./cases.ts";
import { probeCase } from "./probes.ts";
import { scoreCase, type Step, type Trace } from "./score.ts";
import { answer, destinationOf, familyOf, worldPrompt, worldTools } from "./world.ts";

const byId = (id: string): Case => CASES.find((c) => c.id === id)!;
const call = (turn: number, name: string, input: Record<string, unknown>): Step => ({ turn, kind: "call", call: { name, input }, result: "" });
const text = (turn: number, value: string): Step => ({ turn, kind: "text", text: value });
const user = (turn: number, value: string): Step => ({ turn, kind: "user", text: value });

describe("the task-fidelity cases", () => {
  it("cover at least twenty distinct requests", () => {
    expect(CASES.length).toBeGreaterThanOrEqual(20);
    expect(new Set(CASES.map((c) => c.id)).size).toBe(CASES.length);
  });

  it.each(CASES.map((c) => [c.id, c] as const))("%s gets every rule it needs in its prompt and tool descriptions", (_id, c) => {
    const result = probeCase(c);
    expect(result.probes.filter((p) => !p.pass).map((p) => p.id)).toEqual([]);
  });

  it("give each world only the tools it has connected", () => {
    const names = (id: string) => worldTools(byId(id).world).map((t) => t.name);
    expect(names("slack-channel-explicit")).toContain("slack_post");
    expect(names("slack-team-update-open")).not.toContain("slack_post");
    expect(names("slack-team-update-open")).toContain("COMPOSIO_MULTI_EXECUTE_TOOL");
    expect(names("web-lookup")).not.toContain("COMPOSIO_SEARCH_TOOLS");
    expect(worldPrompt(byId("team-update-full-access").world)).toContain("Just do it is on");
  });
});

describe("scoring a played case", () => {
  const flagged = byId("slack-team-update-open");

  it("fails the flagged chat: a DM to one member and a search of the Mac", () => {
    const trace: Trace = { caseId: flagged.id, turns: 1, steps: [
      user(1, flagged.request),
      call(1, "COMPOSIO_MULTI_EXECUTE_TOOL", { tools: [{ tool_slug: "SLACK_SEND_MESSAGE", arguments: { channel: "U01PRIYA", markdown_text: "Update coming soon" } }] }),
      call(1, "Bash", { command: "mdfind -name billing" }),
      call(1, "Bash", { command: "ls ~/Documents/Projects" }),
      text(1, "I sent Priya a note and I'm looking for the project folder."),
    ] };
    const score = scoreCase(flagged, trace);
    expect(score.destination).toBe(false);
    expect(score.asked).toBe(false);
    expect(score.focus).toBe(false);
    expect(score.draft).toBe(false);
    expect(score.pass).toBe(false);
  });

  it("passes asking where it goes, then drafting, then posting in the channel", () => {
    const [where, ok] = flagged.followUps!;
    const trace: Trace = { caseId: flagged.id, turns: 3, steps: [
      user(1, flagged.request),
      call(1, "COMPOSIO_MULTI_EXECUTE_TOOL", { tools: [{ tool_slug: "SLACK_LIST_ALL_CHANNELS", arguments: {} }] }),
      text(1, "Which channel should it go in, #eng-team or #general? And what should it cover this week?"),
      user(2, where!),
      text(2, "Here is the draft for #eng-team: This week Priya shipped the usage-based billing API and Marco is halfway through the invoice PDF redesign. Next up: dunning emails. Post it?"),
      user(3, ok!),
      call(3, "COMPOSIO_MULTI_EXECUTE_TOOL", { tools: [{ tool_slug: "SLACK_SEND_MESSAGE", arguments: { channel: "C02ENG", markdown_text: "This week..." } }] }),
      text(3, "Posted in #eng-team."),
    ] };
    const score = scoreCase(flagged, trace);
    expect(score).toMatchObject({ destination: true, tool: true, steps: true, asked: true, focus: true, draft: true, pass: true });
  });

  it("fails a route the case forbids and a deliverable described instead of made", () => {
    const screen = scoreCase(byId("slack-not-connected"), { caseId: "slack-not-connected", turns: 1, steps: [
      call(1, "launch_app", { app: "Slack" }), call(1, "type_text", { app: "Slack", text: "Mockups are ready" }),
    ] });
    expect(screen.tool).toBe(false);
    expect(screen.destination).toBe(false);
    const steps = scoreCase(byId("calendar-export-file"), { caseId: "calendar-export-file", turns: 1, steps: [
      call(1, "googlecalendar_list_events", {}), text(1, "Open Google Calendar, then Settings, then Export."),
    ] });
    expect(steps.tool).toBe(false);
  });
});

describe("the mocked world", () => {
  const world = byId("slack-dm-two-alexes").world;

  it("names a channel or a person from an id, a #name or an email", () => {
    expect(destinationOf(world, "#eng-team")).toBe("channel:eng-team");
    expect(destinationOf(world, "C02ENG")).toBe("channel:eng-team");
    expect(destinationOf(world, "U03ALEXC")).toBe("dm:Alex Chen");
    expect(destinationOf(world, "alex.morgan@acme.com")).toBe("dm:Alex Morgan");
    expect(destinationOf(world, "#nowhere")).toBe("unknown:nowhere");
  });

  it("files a shell search of the disk under files, and a web call under web", () => {
    expect(familyOf({ name: "Bash", input: { command: "find ~ -name '*atlas*'" } })).toBe("files");
    expect(familyOf({ name: "Bash", input: { command: "curl -s https://example.com | head -c 300" } })).toBe("shell");
    expect(familyOf({ name: "WebFetch", input: { url: "https://example.com" } })).toBe("web");
    expect(familyOf({ name: "slack_post", input: {} })).toBe("connector");
  });

  it("answers a page read for the page last opened", () => {
    const page = {};
    answer(world, { name: "agent_browser_open", input: { url: "https://news.ycombinator.com" } }, page);
    expect(answer(world, { name: "agent_browser_snapshot", input: {} }, page)).toContain("Rust 1.92");
  });
});
