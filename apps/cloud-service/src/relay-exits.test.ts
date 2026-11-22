import { createHash, createPublicKey, generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { StoredCloud } from "../../dashboard/server/clouds/types.ts";
import { PHONE_RELAY_ASIDE_COMMAND } from "./home.ts";
import type { HomeRelease } from "./home-update.ts";
import { signRelease, type ReleaseKey } from "./release-signing.ts";
import { homeFixture } from "./test-fixture.ts";

const { privateKey } = generateKeyPairSync("ed25519");
const signing = `test-rel:${privateKey.export({ format: "der", type: "pkcs8" }).toString("base64url")}`;
const keys: ReleaseKey[] = [{ kid: "test-rel", x: createPublicKey(privateKey).export({ format: "jwk" }).x! }];
const sha = (v: string) => createHash("sha256").update(`pkg-${v}`).digest("hex");
const release = (version: string): HomeRelease => ({ sha256: sha(version), url: `https://packages.example.test/${version}.tgz`,
  signature: signRelease({ kind: "home-package", name: "omb-home", version, sha256: sha(version), signedAt: 1 }, signing) });
const HOUR = 3_600_000;

async function homeOn(version: string) {
  let offered: HomeRelease | null = null;
  const f = await homeFixture({ releaseKeys: keys, settings: { package: release(version) }, release: () => offered, entitlements: { sign: (c: StoredCloud) => `token-for-${c.id}` }, linkGrant: () => "grant" });
  const { c } = await f.paid();
  const pass = async (ms = 61_000) => { f.advance(ms); c.nextAttemptAt = 0; await f.service.reconcile(); };
  await pass();
  const commands = () => f.api.requests.filter(r => r.path.endsWith("/exec")).map(r => (r.body as { cmd: string }).cmd);
  const grants = () => f.home.entitle.mock.calls.map(call => call[3] ?? null);
  return { f, c, pass, commands, grants, offer: (r: HomeRelease | null) => { offered = r; } };
}

describe("homes whose phone relay exits them at start", () => {
  it("a home on 0.2.26 gets its entitlement without a link grant; one on a fixed version gets the grant", async () => {
    const bad = await homeOn("0.2.26");
    expect(bad.c.managed!.update?.guard.current?.version).toBe("0.2.26");
    bad.f.home.entitle.mockClear();
    await bad.pass(HOUR + 60_000);
    expect(bad.grants()).toEqual([null]);

    const good = await homeOn("0.2.27");
    good.f.home.entitle.mockClear();
    await good.pass(HOUR + 60_000);
    expect(good.grants()).toEqual(["grant"]);
  });

  it("moves a 0.2.26 home's saved tunnel aside before its start on a wake, and not a fixed version's", async () => {
    for (const [version, aside] of [["0.2.26", true], ["0.2.27", false]] as const) {
      const t = await homeOn(version);
      await t.f.asleep(t.c);
      const before = t.commands().length;
      t.f.power.idle = false; t.f.power.busy = ["recent-activity"];
      t.c.wantPower = "on";
      await t.f.settle(t.c, x => x.status === "running", 30, 30_000);
      const woke = t.commands().slice(before);
      const start = woke.findIndex(x => x.includes("omb-home start"));
      expect(start).toBeGreaterThanOrEqual(0);
      expect(woke.slice(0, start).includes(PHONE_RELAY_ASIDE_COMMAND)).toBe(aside);
    }
  });

  it("moves the saved tunnel aside when a fixed version is rolled back to 0.2.26, before the home starts", async () => {
    const t = await homeOn("0.2.26");
    t.offer(release("0.2.27"));
    await t.pass();
    expect(t.c.managed!.installed).toBe(sha("0.2.27"));
    Object.assign(t.f.update, { version: "0.2.27", selfTest: "failed" });
    await t.pass();
    const cmds = t.commands(), rollback = cmds.findLastIndex(x => x.includes("omb-home rollback"));
    expect(rollback).toBeGreaterThanOrEqual(0);
    expect(cmds.slice(rollback + 1, rollback + 3)).toEqual([PHONE_RELAY_ASIDE_COMMAND, expect.stringContaining("omb-home start")]);
    expect(t.c.managed!.update?.guard.current?.version).toBe("0.2.26");
  });
});
