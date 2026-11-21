import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const script = readFileSync(new URL("../install.sh", import.meta.url), "utf8");

// a narrow terminal (a phone ssh app) makes COLS minus the step columns negative, and cut rejects `1--1`, ending the install
describe("installer widths", () => {
  it("clamps every cut width it computes from the terminal", () => {
    expect(script.split("\n").filter(line => /cut -c1-\$\(\(COLS - TW/.test(line))).toEqual([]);
    expect(script).toMatch(/_ww=\$\(\(COLS - TW - 16\)\); \[ "\$_ww" -ge 20 \] \|\| _ww=20/);
  });
});
