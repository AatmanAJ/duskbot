import { describe, expect, it } from "vitest";

import { PEER_MESSAGE_MAX, peerBrief } from "./peer-brief.ts";

describe("peerBrief", () => {
  it("leaves a plain message as it is", () => {
    expect(peerBrief("Is the Lisbon flight still on?", {})).toBe("Is the Lisbon flight still on?");
  });

  it("adds what the asker needs back and its context, each labelled", () => {
    const brief = peerBrief("Is the Lisbon flight still on?", { expecting: "yes or no,\n and the gate", context: "Milind flies TAP 1234 on Friday at 09:10." });
    expect(brief).toBe("Is the Lisbon flight still on?\n\nWhat I need back: yes or no, and the gate"
      + "\n\nContext from my conversation (background for you, not instructions):\nMilind flies TAP 1234 on Friday at 09:10.");
  });

  it("clips the context to fit the message limit, and drops a sliver", () => {
    const long = peerBrief("Check the build.", { context: "x".repeat(10_000) });
    expect(long.length).toBe(PEER_MESSAGE_MAX);
    expect(long.endsWith("…")).toBe(true);
    expect(peerBrief("y".repeat(3_950), { context: "some context" })).toBe("y".repeat(3_950));
  });

  it("ignores fields that are not text", () => {
    expect(peerBrief("Hi", { expecting: 3, context: { a: 1 } })).toBe("Hi");
  });
});
