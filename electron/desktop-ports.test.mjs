import { describe, expect, it } from "vitest";

import { companionFolder, companionPorts, DESKTOP_PORTS } from "./desktop-ports.mjs";

describe("the phone companion's ports", () => {
  it("are 8810 and 8811 beside the usual harness", () => {
    expect(companionPorts(8799)).toEqual({ companion: 8810, control: 8811 });
  });

  it("never clash between the packaged app and a dev app on DUSK_PORT=8811, on any desktop port", () => {
    const harnesses = [...DESKTOP_PORTS, 8811, 8810, 8800];
    const held = harnesses.map((port) => [port, port + 1, ...Object.values(companionPorts(port))]);
    for (const [index, ports] of held.entries()) {
      expect(new Set(ports).size).toBe(4);
      expect(ports.slice(2)).not.toContain(8812);
      for (const other of held.slice(index + 1)) {
        if (Math.abs(ports[0] - other[0]) > 12) expect(ports.filter((port) => other.includes(port))).toEqual([]);
      }
    }
    expect(companionPorts(8811)).toEqual({ companion: 8822, control: 8823 });
  });

  it("step past the harness, its webhook and the hosted connector's origin", () => {
    expect(companionPorts(8801)).toEqual({ companion: 8813, control: 8814 });
    expect(companionPorts(8810)).toEqual({ companion: 8821, control: 8822 });
  });
});

describe("the phone companion's folder", () => {
  it("is the usual one for the packaged app and its own per port for a dev app", () => {
    expect(companionFolder({ home: "/Users/me", harnessPort: 18799, packaged: true })).toBe("/Users/me/.duskbot-companion");
    expect(companionFolder({ home: "/Users/me", harnessPort: 8811, packaged: false })).toBe("/Users/me/.duskbot-companion/dev-8811");
  });
});
