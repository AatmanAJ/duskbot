import { describe, expect, it } from "vitest";

import { sharedServerJoins } from "./mcp-shared-join.ts";

const notion = { type: "http", url: "https://mcp.notion.com/mcp", headers: {}, enabled: true };
const notes = { command: "npx", args: ["-y", "notes-mcp"], env: {}, enabled: true };

describe("a shared server connected later", () => {
  it("joins every bot whose own selection names servers, so a second bot gets Notion too", () => {
    const bots = [{ id: "a" }, { id: "b", mcpServers: ["notes"] }, { id: "c", mcpServers: ["notes", "notion"] }];
    expect(sharedServerJoins({ notes }, { notes, notion }, bots)).toEqual([{ botId: "b", mcpServers: ["notes", "notion"] }]);
  });

  it("leaves a bot given no servers, a bot's own server and a server that was already there alone", () => {
    const bots = [{ id: "none", mcpServers: [] }, { id: "b", mcpServers: ["notes"] }];
    expect(sharedServerJoins({ notes }, { notes, notion }, [bots[0]!])).toEqual([]);
    expect(sharedServerJoins({ notes }, { notes, mine: { ...notes, bot: "x" } }, bots)).toEqual([]);
    expect(sharedServerJoins({ notes, notion: { ...notion, enabled: false } }, { notes, notion }, bots)).toEqual([]);
    expect(sharedServerJoins(undefined, { notion }, bots)).toEqual([{ botId: "b", mcpServers: ["notes", "notion"] }]);
  });
});
