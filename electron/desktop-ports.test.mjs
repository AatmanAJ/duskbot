import { describe, expect, it } from "vitest";

import { companionControlPort } from "./desktop-ports.mjs";

describe("the phone companion's control port", () => {
  it("is 8811 beside the usual harness", () => {
    expect(companionControlPort(8799)).toBe(8811);
  });

  it("steps past a harness on 8811 and its webhook on 8812, and past the companion's own 8810", () => {
    expect(companionControlPort(8811)).toBe(8813);
    expect(companionControlPort(8810)).toBe(8812);
  });
});
