import { describe, expect, it } from "vitest";
import { CLOUD_OPENED_HERE, cloudOpenedHere, lateCloudDue, ownCloudPlan } from "./late-cloud";

const done = { completedAt: "2026-11-17T10:00:00.000Z", version: 1, reelSeen: false, hintsSeen: ["met-chief-v1"] };
const mine = (status: string) => ({ status: "connected", clouds: [{ primary: true, runsOn: "cloud", role: "owner", status }] });
const base = { local: true, canSave: true, config: { onboarding: done }, account: mine("setting_up"), welcomeShown: false };

describe("a dusk cloud plan that comes after the first run", () => {
  it("takes the person into the cloud being made, once, after the first run ended here", () => {
    expect(lateCloudDue(base)).toBe(true);
    expect(lateCloudDue({ ...base, account: mine("ready") })).toBe(true);
    expect(lateCloudDue({ ...base, config: { onboarding: { ...done, hintsSeen: [...done.hintsSeen, CLOUD_OPENED_HERE] } } }), "once only").toBe(false);
    expect(lateCloudDue({ ...base, config: { onboarding: { ...done, completedAt: "" } } }), "the first run itself handles it").toBe(false);
    expect(lateCloudDue({ ...base, welcomeShown: true })).toBe(false);
    expect(lateCloudDue({ ...base, local: false }), "never on a remote page").toBe(false);
    expect(lateCloudDue({ ...base, config: { onboarding: done, team: { id: "t" } } })).toBe(false);
  });

  it("never for a team member on someone else's plan", () => {
    expect(ownCloudPlan({ status: "connected", clouds: [{ primary: false, runsOn: "cloud", role: "member", status: "ready" }] })).toBe(false);
    expect(ownCloudPlan({ status: "connected", clouds: [{ primary: true, runsOn: "cloud", role: "member", status: "ready" }] })).toBe(false);
    expect(ownCloudPlan({ status: "connected", machine: { status: "ready" } }), "an older Admin's machine without a renewal of their own").toBe(false);
    expect(ownCloudPlan({ status: "connected", machine: { status: "provisioning" }, renewal: { renewsAt: 1 } })).toBe(true);
    expect(ownCloudPlan({ status: "signed-out", purchase: {} })).toBe(false);
    expect(ownCloudPlan(mine("ended"))).toBe(false);
  });

  it("a first run that went the dusk cloud way is kept as the one that made it, with every hint it had", () => {
    expect(cloudOpenedHere({ onboarding: { completedAt: "x", version: 1 } as { completedAt: string; version: number; hintsSeen?: string[] } }, true, ["a"]).onboarding.hintsSeen).toEqual(["a", CLOUD_OPENED_HERE]);
    expect(cloudOpenedHere({ onboarding: { completedAt: "x", version: 1, hintsSeen: ["a", "b"] } }, true).onboarding.hintsSeen).toEqual(["a", "b", CLOUD_OPENED_HERE]);
    expect(cloudOpenedHere({ onboarding: { completedAt: "x", version: 1 } as { completedAt: string; version: number; hintsSeen?: string[] } }, false).onboarding.hintsSeen).toBeUndefined();
  });
});
