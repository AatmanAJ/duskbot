import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { COMPUTER_UNREACHABLE } from "../../shared/computer-unreachable.ts";
import { createUpdateHost } from "./update-host.ts";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe("the update report's runs", () => {
  it("marks a run that failed for want of its computer, never one that failed otherwise or went through", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "dusk-update-host-")); dirs.push(dataDir);
    const host = createUpdateHost({ dataDir, version: "1.0.0", health: () => true, browser: async () => null, connected: async () => null, relay: async () => ({}) as never, log: () => {},
      runs: () => [
        { id: "a", status: "failed", finishedAt: Date.now() + 1, error: COMPUTER_UNREACHABLE },
        { id: "b", status: "failed", finishedAt: Date.now() + 2, error: 'error during connect: Get "http://%2Frun%2Fopenmausbot-docker%2Fdocker.sock/v1.56/containers/json": EOF' },
        { id: "c", status: "failed", finishedAt: Date.now() + 3, error: "The model refused." },
        { id: "d", status: "completed", finishedAt: Date.now() + 4 },
      ] });
    expect(host.report().runs.map(r => [r.id, r.ok, r.infra ?? false])).toEqual([["a", false, true], ["b", false, true], ["c", false, false], ["d", true, false]]);
  });
});
