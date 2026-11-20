import { describe, expect, it } from "vitest";
import { addHeldSecretScrubber } from "../shared/redact.ts";
import { turnStartLogLine } from "./turn-log.ts";

describe("turnStartLogLine", () => {
  const turn = { botId: "bot-1", text: "what is six times seven", images: 0, depth: 0, card: false };

  it("shows the start of a typed prompt, so a stuck turn can be traced", () => {
    expect(turnStartLogLine({ ...turn, spoken: false })).toBe(
      '[dusk-turn] bot=bot-1 text="what is six times seven" images=0 depth=0 card=false',
    );
    expect(turnStartLogLine({ ...turn, text: "x".repeat(200), spoken: false })).toContain(`text="${"x".repeat(70)}" `);
  });

  it("never logs words spoken on a Live call", () => {
    const line = turnStartLogLine({ ...turn, images: 1, depth: 0, card: true, spoken: true });
    expect(line).not.toContain("six times seven");
    expect(line).toBe("[dusk-turn] bot=bot-1 text=(spoken) images=1 depth=0 card=true");
  });

  it("masks a key or password pasted into the chat", () => {
    const key = `sk-ant-api03-${"FAKE".repeat(10)}`;
    const line = turnStartLogLine({ ...turn, text: `key ${key} password=fakepass123`, spoken: false });
    expect(line).not.toContain(key.slice(0, 24));
    expect(line).not.toContain("fakepass123");
    expect(line).toContain("«redacted");
  });

  it("masks a held secret value", () => {
    const remove = addHeldSecretScrubber((text) => text.replaceAll("plain-held-value", "••••••"));
    try {
      expect(turnStartLogLine({ ...turn, text: "use plain-held-value here", spoken: false })).not.toContain("plain-held-value");
    } finally {
      remove();
    }
  });
});
