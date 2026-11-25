import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { addLaneWorktree, laneBranch, laneDiff, ownLaneFolder, probeRepo, removeLaneWorktree } from "./mission-worktrees.ts";

let root: string;
let repo: string;
let host: { dataDir: string };
const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "Ada", GIT_AUTHOR_EMAIL: "ada@example.com", GIT_COMMITTER_NAME: "Ada", GIT_COMMITTER_EMAIL: "ada@example.com" } }).trim();

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "dusk-worktrees-"));
  repo = join(root, "shop");
  host = { dataDir: join(root, "data") };
  mkdirSync(repo);
  mkdirSync(host.dataDir);
  git(repo, "init", "--quiet", "--initial-branch=main");
  writeFileSync(join(repo, "README.md"), "# Shop\n");
  writeFileSync(join(repo, "prices.md"), "Mug: $28\nBowl: $34\n");
  writeFileSync(join(repo, "old.md"), "retired\n");
  git(repo, "add", ".");
  git(repo, "commit", "--quiet", "-m", "start");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("probeRepo", () => {
  it("names the repository, its commit and branch, and whether it has uncommitted changes", async () => {
    const head = git(repo, "rev-parse", "HEAD");
    expect(await probeRepo(host, join(repo))).toEqual({ ok: true, root: expect.stringMatching(/shop$/), head, branch: "main", dirty: false });
    writeFileSync(join(repo, "prices.md"), "Mug: $30\n");
    expect(await probeRepo(host, repo)).toMatchObject({ ok: true, dirty: true });
  });

  it("refuses what is not a repository with commits", async () => {
    const plain = join(root, "plain");
    mkdirSync(plain);
    expect(await probeRepo(host, plain)).toEqual({ ok: false, error: "That folder is not in a git repository" });
    const empty = join(root, "empty");
    mkdirSync(empty);
    git(empty, "init", "--quiet");
    expect(await probeRepo(host, empty)).toEqual({ ok: false, error: "That repository has no commits yet" });
    expect((await probeRepo(host, "relative/path")).ok).toBe(false);
    expect((await probeRepo(host, join(root, "missing"))).ok).toBe(false);
  });
});

describe("lane worktrees", () => {
  it("gives each lane a branch and folder of its own, and shows everything it did against the base", async () => {
    const base = git(repo, "rev-parse", "HEAD");
    const ada = await addLaneWorktree(host, { repo, base, missionId: "m-abc123def", title: "Spring launch!", lane: 0, botName: "Ada Lovelace" });
    const ben = await addLaneWorktree(host, { repo, base, missionId: "m-abc123def", title: "Spring launch!", lane: 1, botName: "Ben" });
    expect(ada.branch).toBe("mission/spring-launch-abc123/1-ada-lovelace");
    expect(ben.branch).toBe(laneBranch("m-abc123def", "Spring launch!", 1, "Ben"));
    expect(ada.path).not.toBe(ben.path);
    expect(ownLaneFolder(host, ada.path)).toBe(true);
    expect(git(repo, "branch", "--list", "mission/*").split("\n").map((line) => line.replace(/^[*+ ]+/, ""))).toHaveLength(2);

    writeFileSync(join(ada.path, "prices.md"), "Mug: $28\nBowl: $32\nVase: $58\n");
    git(ada.path, "commit", "--quiet", "-am", "price the vase");
    unlinkSync(join(ada.path, "old.md"));
    writeFileSync(join(ada.path, "launch.md"), "# Launch\nSoft launch on the 14th\n");
    const diff = await laneDiff(host, { path: ada.path, base, branch: ada.branch });
    expect(diff).toMatchObject({ base, branch: ada.branch, commits: 1, truncated: false });
    expect(diff.files).toEqual([
      { path: "old.md", change: "deleted", added: 0, removed: 1 },
      { path: "prices.md", change: "changed", added: 2, removed: 1 },
      { path: "launch.md", change: "added", added: 2, removed: 0 },
    ]);
    expect(diff.patch).toContain("+Vase: $58");
    expect(diff.patch).toContain("+Soft launch on the 14th");
    expect((await laneDiff(host, { path: ben.path, base, branch: ben.branch })).files).toEqual([]);
    expect(git(repo, "status", "--porcelain")).toBe("");

    await removeLaneWorktree(host, { path: ada.path, repo });
    expect(existsSync(ada.path)).toBe(false);
    expect(git(repo, "log", "--format=%s", "-1", ada.branch)).toBe("price the vase");
    expect(await laneDiff(host, { path: ada.path, base, branch: ada.branch })).toMatchObject({ gone: true, files: [] });
  });

  it("never touches a folder it did not make, nor a commit that is not whole", async () => {
    const base = git(repo, "rev-parse", "HEAD");
    expect(ownLaneFolder(host, repo)).toBe(false);
    expect(ownLaneFolder(host, join(host.dataDir, "mission-worktrees"))).toBe(false);
    expect(ownLaneFolder(host, join(host.dataDir, "mission-worktrees", "..", "bots.json"))).toBe(false);
    await expect(laneDiff(host, { path: repo, base, branch: "main" })).rejects.toThrow("not a mission lane's folder");
    await expect(removeLaneWorktree(host, { path: repo, repo })).rejects.toThrow("not a mission lane's folder");
    await expect(addLaneWorktree(host, { repo, base: "HEAD", missionId: "m-abc123", title: "x", lane: 0, botName: "Ada" })).rejects.toThrow("full commit id");
    await expect(addLaneWorktree(host, { repo, base: "0".repeat(40), missionId: "m-abc123", title: "x", lane: 0, botName: "Ada" })).rejects.toThrow("not in the repository");
  });

  it("runs none of the repository's own hooks", async () => {
    const marker = join(root, "hook-ran");
    writeFileSync(join(repo, ".git", "hooks", "post-checkout"), `#!/bin/sh\ntouch "${marker}"\n`, { mode: 0o755 });
    await addLaneWorktree(host, { repo, base: git(repo, "rev-parse", "HEAD"), missionId: "m-hooks1", title: "x", lane: 0, botName: "Ada" });
    expect(existsSync(marker)).toBe(false);
  });
});
