import { describe, expect, it } from "vitest";
import { chatBackups } from "./chat-backups.ts";

describe("chatBackups", () => {
  it("keeps the bot's order and only enabled chat-completions engines with a model", () => {
    const complete = async () => { throw new Error("unused"); };
    const engine = (instanceId: string, extra: object = {}) => ({ instanceId, driverKind: instanceId, adapter: { chatCompletion: complete }, ...extra });
    const engines: Record<string, unknown> = {
      groq: engine("groq"), claude: engine("claude", { adapter: {} }), off: engine("off", { enabled: false }),
      mistral: engine("mistral", { enabled: true }), barred: engine("barred"), self: engine("self"),
    };
    const picked = chatBackups(
      [{ instanceId: "self", model: "m" }, { instanceId: "claude", model: "opus" }, { instanceId: "mistral", model: "mistral-large" }, { instanceId: "off", model: "x" },
        { instanceId: "barred", model: "z" }, { instanceId: "gone", model: "y" }, { instanceId: "groq", model: " " }, { instanceId: "groq", model: "llama" }],
      (id) => engines[id] as never, (id) => `AI ${id}`, "self", (found) => found.instanceId === "barred" ? "not allowed" : undefined);
    expect(picked.map(({ name, model }) => ({ name, model }))).toEqual([{ name: "AI mistral", model: "mistral-large" }, { name: "AI groq", model: "llama" }]);
  });
});
