import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

const SURFACES = [
  "src/components/bot-panel/modals/use-skill-actions.ts",
  "src/components/bot-settings/SkillsSection.tsx",
  "src/components/keys/KeyRow.tsx",
];

for (const file of SURFACES) {
  it(`${file} asks in the app's own dialog, not window.confirm`, () => {
    const source = readFileSync(join(process.cwd(), file), "utf8");
    expect(source).not.toMatch(/window\.confirm\(/);
  });
}
