import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { launchVerificationServer, type VerificationServer } from "../scripts/control-dusk.ts";

describe("mission lanes in worktrees of one repository, through an isolated fixture with git", () => {
  let fixture: VerificationServer;
  const root = mkdtempSync(join(tmpdir(), "dusk-mission-repo-"));
  const repo = join(root, "shop");
  const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, encoding: "utf8",
    env: { ...process.env, GIT_AUTHOR_NAME: "Ada", GIT_AUTHOR_EMAIL: "ada@example.com", GIT_COMMITTER_NAME: "Ada", GIT_COMMITTER_EMAIL: "ada@example.com" } }).trim();
  const api = async (method: string, path: string, body?: unknown) => {
    const response = await fetch(`${fixture.info.url}${path}`, {
      method, headers: { "content-type": "application/json", origin: fixture.info.url }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json() as any };
  };

  beforeAll(async () => {
    mkdirSync(repo);
    git("init", "--quiet", "--initial-branch=main");
    writeFileSync(join(repo, "prices.md"), "Mug: $28\n");
    git("add", ".");
    git("commit", "--quiet", "-m", "start");
    fixture = await launchVerificationServer({ ...process.env, DUSK_VERIFY_GIT: "1" }, undefined, undefined, undefined, { scripted: true });
  }, 60_000);
  afterAll(async () => {
    await fixture?.close();
    rmSync(root, { recursive: true, force: true });
  });

  it("makes a worktree per lane, shows each lane's diff and changed files, and keeps the branch when the folder goes", async () => {
    const probe = (await api("GET", `/api/mission-repo?path=${encodeURIComponent(repo)}`)).body;
    expect(probe).toMatchObject({ ok: true, head: git("rev-parse", "HEAD"), branch: "main", dirty: false });
    expect((await api("GET", `/api/mission-repo?path=${encodeURIComponent(root)}`)).body).toMatchObject({ ok: false });

    const ada = (await api("POST", "/api/bots", { name: "Ada" })).body.bot;
    const ben = (await api("POST", "/api/bots", { name: "Ben" })).body.bot;
    writeFileSync(join(fixture.info.dataDir, "room-plan.json"), JSON.stringify({
      [ada.id]: { reply: "Priced the vase.", writeFiles: { "prices.md": "Mug: $28\nVase: $58\n", "launch.md": "# Launch\n" } },
      [ben.id]: { reply: "Nothing to change." },
    }));
    const mission = { id: "m-repo-lanes", title: "Price the vase", launchedAt: Date.now() - 1_000, worktree: { repo, base: probe.head } };
    expect((await api("POST", `/api/bots/${ada.id}/tasks`, { select: false, cwd: repo, mission: { ...mission, lane: 0 } })).status).toBe(400);
    expect((await api("POST", `/api/bots/${ada.id}/tasks`, { select: false, mission: { ...mission, lane: 0, worktree: { repo, base: "HEAD" } } })).status).toBe(400);
    const lanes = [];
    for (const [lane, bot] of [ada, ben].entries()) {
      const made = await api("POST", `/api/bots/${bot.id}/tasks`, { title: mission.title, select: false, mission: { ...mission, lane } });
      expect(made.status).toBe(201);
      expect(made.body.task.mission.worktree).toEqual({ repo: expect.stringMatching(/shop$/), base: probe.head, branch: expect.stringMatching(/^mission\/price-the-vase-repo-l\/\d-/) });
      expect(made.body.task.cwd).toContain("mission-worktrees");
      lanes.push({ bot, threadId: made.body.task.threadId as string });
      expect((await api("POST", `/api/bots/${bot.id}/messages`, { threadId: made.body.task.threadId, text: "Price the new vase", sendId: `send-lane-${lane}-of-repo` })).status).toBe(202);
    }
    const lane = async (botId: string) => (await api("GET", `/api/missions/${mission.id}`)).body.board.find((row: any) => row.botId === botId);
    await expect.poll(async () => (await lane(ada.id))?.state, { timeout: 30_000 }).toBe("done");
    await expect.poll(async () => (await lane(ada.id))?.files, { timeout: 15_000 }).toEqual([
      { path: "launch.md", change: "added" }, { path: "prices.md", change: "changed" },
    ]);
    expect((await lane(ada.id)).worktree).toMatchObject({ base: probe.head });

    const diff = (await api("GET", `/api/missions/${mission.id}/lanes/${lanes[0]!.threadId}/diff`)).body;
    expect(diff.files).toEqual(expect.arrayContaining([
      { path: "prices.md", change: "changed", added: 1, removed: 0 }, { path: "launch.md", change: "added", added: 1, removed: 0 },
    ]));
    expect(diff.patch).toContain("+Vase: $58");
    await expect.poll(async () => (await lane(ben.id))?.state, { timeout: 30_000 }).toBe("done");
    expect((await api("GET", `/api/missions/${mission.id}/lanes/${lanes[1]!.threadId}/diff`)).body.files).toEqual([]);
    expect(git("status", "--porcelain")).toBe("");
    expect((await api("GET", `/api/missions/other-mission/lanes/${lanes[0]!.threadId}/diff`)).status).toBe(404);

    const branch = (await lane(ada.id)).worktree.branch;
    const removed = await api("DELETE", `/api/missions/${mission.id}/lanes/${lanes[0]!.threadId}/worktree`);
    expect(removed).toMatchObject({ status: 200, body: { ok: true, branch } });
    expect(existsSync((await lane(ada.id)).cwd)).toBe(false);
    expect(git("branch", "--list", branch)).toContain(branch);
    expect((await api("GET", `/api/missions/${mission.id}/lanes/${lanes[0]!.threadId}/diff`)).body).toMatchObject({ gone: true });
  }, 120_000);
});
