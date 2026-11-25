import { describe, expect, it } from "vitest";

import { setLocale } from "@/lib/i18n";
import { skillRowHint } from "./skill-row-hint";

const skill = (enabled: boolean, warnings: string[]) => ({ name: "laptop-setup", description: "Sets up a new laptop", enabled, source: "Grok Bot", warnings });

describe("a skill's row in the bot panel", () => {
  it("says a skill the scan held back is off for review, not just what it does", () => {
    setLocale("en");
    expect(skillRowHint(skill(false, ["pipes a download straight into a shell (curl|sh); never enable without understanding why"])))
      .toBe("Off: held back for review. Switching it on shows you the whole skill first.");
    expect(skillRowHint(skill(false, []))).toBe("Sets up a new laptop");
    expect(skillRowHint(skill(true, ["reviewed"]))).toBe("Sets up a new laptop");
  });
});
