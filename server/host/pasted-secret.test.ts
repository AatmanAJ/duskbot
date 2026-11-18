import { describe, expect, it } from "vitest";

import type { Message } from "../store.ts";
import { pastedSecret, valueUnderName } from "./pasted-secret.ts";

const said = (role: "user" | "bot", text: string) => ({ id: text, at: 0, role, kind: "text", text }) as Message;

describe("a secret the person pasted in their own message", () => {
  it("is found under its env name or its label, however it is written", () => {
    const block = "set these up\nNITTER_URL=https://nitter.example.test\nexport NITTER_KEY=\"nk_123abc\"\nHindsight token: hs-9f8e7d6c5b4a";
    expect(valueUnderName(block, "NITTER_KEY")).toBe("nk_123abc");
    expect(valueUnderName(block, "Nitter key")).toBe("nk_123abc");
    expect(valueUnderName(block, "nitter url")).toBe("https://nitter.example.test");
    expect(valueUnderName(block, "HINDSIGHT_TOKEN")).toBe("hs-9f8e7d6c5b4a");
    expect(valueUnderName("XACTIONS_TOKEN=abc123", "xactions token")).toBe("abc123");
  });

  it("is not prose, a placeholder or a longer name that only ends the same", () => {
    expect(valueUnderName("Hindsight token: here", "Hindsight token")).toBeNull();
    expect(valueUnderName("XACTIONS_TOKEN=<your token>", "XACTIONS_TOKEN")).toBeNull();
    expect(valueUnderName("XACTIONS_TOKEN=xxxxxxxx", "XACTIONS_TOKEN")).toBeNull();
    expect(valueUnderName("OLD_XACTIONS_TOKEN=abc123", "XACTIONS_TOKEN")).toBeNull();
    expect(valueUnderName("I need the xactions token", "xactions token")).toBeNull();
  });

  it("comes from the person's newest message only, never from a bot's", () => {
    expect(pastedSecret([said("user", "API_KEY=old111"), said("user", "API_KEY=new222")], ["API_KEY"])).toBe("new222");
    expect(pastedSecret([said("bot", "set API_KEY=bot333 like this")], ["API_KEY"])).toBeNull();
  });
});
