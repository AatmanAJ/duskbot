import { describe, expect, it } from "vitest";
import { chatBackups } from "./chat-backups.ts";

describe("chatBackups", () => {
  it("keeps the bot's order and only enabled chat-completions engines with a model", () => {
    const complete = async () => { throw new Error("unused"); };
    const engines: Record<string, { enabled?: boolean; adapter: { chatCompletion?: typeof complete } }> = {
      groq: { adapter: { chatCompletion: complete } },
      claude: { adapter: {} },
      off: { enabled: false, adapter: { chatCompletion: complete } },
      mistral: { enabled: true, adapter: { chatCompletion: complete } },
    };
    const picked = chatBackups(
      [{ instanceId: "claude", model: "opus" }, { instanceId: "mistral", model: "mistral-large" }, { instanceId: "off", model: "x" },
        { instanceId: "gone", model: "y" }, { instanceId: "groq", model: " " }, { instanceId: "groq", model: "llama" }],
      (id) => engines[id] as never, (id) => `AI ${id}`);
    expect(picked.map(({ name, model }) => ({ name, model }))).toEqual([{ name: "AI mistral", model: "mistral-large" }, { name: "AI groq", model: "llama" }]);
  });
});
