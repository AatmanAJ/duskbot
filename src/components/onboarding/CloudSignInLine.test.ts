import { describe, expect, it } from "vitest";
import type { InstanceInfo } from "@/state/store";
import { setLocale, t } from "@/lib/i18n";
import { computerTiles } from "./AiStep";
import { missingCloudAi } from "./CloudSignInLine";
import { aiTiles } from "./funnel";
import { engineReady } from "@/components/EngineLibrary";

const ai = (instanceId: string, driverKind: string, ready: boolean) => ({
  instanceId, driverKind, displayName: instanceId, access: "subscription", models: { default: "m", options: [] },
  snapshot: { state: "available", authenticated: ready },
}) as unknown as InstanceInfo;

describe("the new cloud's line for an AI that didn't come along", () => {
  const instances = [ai("codex", "codex", false), ai("claude", "claudeAgent", false), ai("grok", "grokAgent", false)];
  const tiles = aiTiles(instances, engineReady);

  it("names the AI used on the computer that isn't signed in here, while none of the person's own works", () => {
    expect(missingCloudAi(tiles, computerTiles(["claude"], instances), false)?.label).toBe("Claude");
    expect(missingCloudAi(tiles, computerTiles(["codex", "claude"], instances), false)?.label, "the first the grid lists").toBe("ChatGPT");
  });

  it("says nothing once an AI of the person's own works here, or when the computer used none", () => {
    expect(missingCloudAi(tiles, computerTiles(["claude"], instances), true)).toBeNull();
    expect(missingCloudAi(tiles, [], false)).toBeNull();
    const signedIn = aiTiles([ai("claude", "claudeAgent", true)], engineReady);
    expect(missingCloudAi(signedIn, ["claude"], false)).toBeNull();
  });

  it("reads as the owner asked", () => {
    setLocale("en");
    expect(t("cloudSignIn.line", { name: "Claude" })).toBe("Sign in to Claude here to use it on your cloud.");
  });
});
