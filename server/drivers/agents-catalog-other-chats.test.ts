import { describe, expect, it } from "vitest";

import { agentsServerEnv } from "../agents-turn.ts";
import { availableTools, fullInputSchema } from "./agents-catalog.ts";
import { catalogProfileFromEnv } from "./agents-catalog-profile.ts";

const sessionSearch = (env: Record<string, string>) => availableTools(catalogProfileFromEnv(env)).find((tool) => tool.name === "session_search")!;

describe("session_search and other bots' chats", () => {
  it("lists bot only for a bot whose person turned reading other bots' chats on", () => {
    const off = sessionSearch({});
    expect(Object.keys(off.inputSchema.properties ?? {})).not.toContain("bot");
    expect(off.description).not.toContain("read other bots' chats");
    const on = sessionSearch({ DUSK_READS_OTHER_CHATS: "1" });
    expect(Object.keys(on.inputSchema.properties ?? {})).toContain("bot");
    expect(on.description).toContain("The person also let you read other bots' chats, read-only");
  });

  it("holds every call to the full schema, so the server, not the list, refuses a read that is off", () => {
    expect(Object.keys((fullInputSchema("session_search") as { properties: object }).properties)).toContain("bot");
  });

  it("turns the switch on from the bot's setting, never on dusk cloud or in a room", () => {
    const env = (readsOtherChats: boolean | undefined, cloudHome = false, room = false) => agentsServerEnv({
      threadId: "th", bot: { id: "b", readsOtherChats } as never, room, teamComputer: false,
      host: { skillAuthoring: false, cloudHome, team: false, voiceNotes: false, x: false, research: false },
    }, { generation: "g", depth: 0, skillAuthoring: false }, () => "token", "http://127.0.0.1:9").DUSK_READS_OTHER_CHATS;
    expect(env(true)).toBe("1");
    expect(env(undefined)).toBe("0");
    expect(env(true, true)).toBe("0");
    expect(env(true, false, true)).toBe("0");
  });
});
