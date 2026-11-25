import { execFile } from "node:child_process";
import { existsSync, mkdirSync, realpathSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import type { LaneDiff, LaneDiffFile, RepoProbe } from "../shared/mission.ts";
import { validateBotCwd } from "./bot-cwd.ts";

export const WORKTREES_DIR = "mission-worktrees";
const GIT_TIMEOUT_MS = 20_000;
const OUTPUT_MAX = 16 * 1024 * 1024;
export const PATCH_MAX = 400_000;
const FILES_MAX = 300;
const UNTRACKED_DIFFED_MAX = 60;
const COMMIT = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;

/** Git with nothing from the caller's environment redirecting it, and no hook of the repository run. */
function git(args: string[], cwd: string, noHooks: string, okCodes: readonly number[] = [0]): Promise<string> {
  const env: NodeJS.ProcessEnv = { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0" };
  for (const name of Object.keys(env)) if (name.startsWith("GIT_") && name !== "GIT_TERMINAL_PROMPT" && name !== "GIT_OPTIONAL_LOCKS") delete env[name];
  return new Promise((done, fail) => {
    execFile("git", ["-c", `core.hooksPath=${noHooks}`, "-c", "core.quotePath=false", ...args], {
      cwd, env, windowsHide: true, timeout: GIT_TIMEOUT_MS, maxBuffer: OUTPUT_MAX, encoding: "utf8",
    }, (error, stdout, stderr) => {
      const code = (error as { code?: number | string } | null)?.code;
      if (!error || (typeof code === "number" && okCodes.includes(code))) return done(stdout);
      if (code === "ENOENT") return fail(new Error("git isn't installed on the computer this server runs on"));
      fail(new Error(stderr.trim().split("\n").at(-1) || error.message));
    });
  });
}

export interface WorktreeHost {
  dataDir: string;
}

const noHooksDir = (host: WorktreeHost) => join(host.dataDir, WORKTREES_DIR, ".no-hooks");

export async function probeRepo(host: WorktreeHost, path: unknown): Promise<RepoProbe> {
  const checked = validateBotCwd(path);
  if (!checked.ok) return { ok: false, error: checked.error };
  if (!checked.cwd) return { ok: false, error: "Choose the folder of a git repository" };
  const noHooks = noHooksDir(host);
  try {
    const root = (await git(["rev-parse", "--show-toplevel"], checked.cwd, noHooks)).trim();
    if (!root) return { ok: false, error: "That folder is not in a git repository" };
    if (inside(realpathSync(root), realpathSync(resolve(host.dataDir)))) return { ok: false, error: "Pick a repository of your own, not one inside dusk bot's data" };
    const head = (await git(["rev-parse", "--verify", "--quiet", "HEAD^{commit}"], root, noHooks, [0, 1])).trim();
    if (!head) return { ok: false, error: "That repository has no commits yet" };
    const branch = (await git(["symbolic-ref", "--quiet", "--short", "HEAD"], root, noHooks, [0, 1])).trim();
    const dirty = (await git(["status", "--porcelain", "--untracked-files=no"], root, noHooks)).trim().length > 0;
    return { ok: true, root, head, ...(branch ? { branch } : {}), dirty };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: /not a git repository/i.test(message) ? "That folder is not in a git repository" : message };
  }
}

const slug = (text: string, max = 24) => text.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, max).replace(/-+$/, "") || "lane";

export function laneBranch(missionId: string, title: string, lane: number, botName: string): string {
  return `mission/${slug(title)}-${missionId.replace(/^m-/, "").slice(0, 6)}/${lane + 1}-${slug(botName, 16)}`;
}

export function lanePath(host: WorktreeHost, missionId: string, lane: number, botName: string): string {
  return join(host.dataDir, WORKTREES_DIR, missionId, `${lane + 1}-${slug(botName, 16)}`);
}

export interface LaneWorktree { path: string; branch: string; base: string; repo: string }

export async function addLaneWorktree(host: WorktreeHost, input: { repo: string; base: string; missionId: string; title: string; lane: number; botName: string }): Promise<LaneWorktree> {
  if (!COMMIT.test(input.base)) throw new Error("base must be a full commit id");
  const probe = await probeRepo(host, input.repo);
  if (!probe.ok) throw new Error(probe.error);
  const noHooks = noHooksDir(host);
  await git(["cat-file", "-e", `${input.base}^{commit}`], probe.root, noHooks).catch(() => { throw new Error("That commit is not in the repository"); });
  const path = lanePath(host, input.missionId, input.lane, input.botName);
  if (existsSync(path)) throw new Error("That lane already has a folder");
  mkdirSync(join(host.dataDir, WORKTREES_DIR, input.missionId), { recursive: true });
  const branch = laneBranch(input.missionId, input.title, input.lane, input.botName);
  await git(["worktree", "add", "--quiet", "-b", branch, "--", path, input.base], probe.root, noHooks);
  return { path, branch, base: input.base, repo: probe.root };
}

const inside = (child: string, parent: string) => {
  const rel = relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !rel.startsWith("/") && !/^[a-zA-Z]:/.test(rel));
};

/** Only a folder this server made for a lane, never one a caller names. */
export function ownLaneFolder(host: WorktreeHost, path: string): boolean {
  return inside(resolve(path), join(resolve(host.dataDir), WORKTREES_DIR)) && resolve(path) !== join(resolve(host.dataDir), WORKTREES_DIR);
}

function parseNumstat(text: string): Map<string, { added: number; removed: number; binary: boolean }> {
  const out = new Map<string, { added: number; removed: number; binary: boolean }>();
  for (const line of text.split("\n")) {
    const [added, removed, ...rest] = line.split("\t");
    const path = rest.join("\t");
    if (!path) continue;
    const binary = added === "-";
    out.set(path.includes(" => ") ? path.replace(/\{?[^{}]* => ([^{}]*)\}?/, "$1") : path, { added: binary ? 0 : Number(added), removed: binary ? 0 : Number(removed), binary });
  }
  return out;
}

const STATUS: Record<string, LaneDiffFile["change"]> = { A: "added", D: "deleted", M: "changed", R: "renamed", C: "added", T: "changed" };

export async function laneDiff(host: WorktreeHost, worktree: { path: string; base: string; branch: string }): Promise<LaneDiff> {
  if (!ownLaneFolder(host, worktree.path)) throw new Error("not a mission lane's folder");
  if (!existsSync(worktree.path)) return { base: worktree.base, branch: worktree.branch, files: [], patch: "", truncated: false, gone: true };
  if (!COMMIT.test(worktree.base)) throw new Error("base must be a full commit id");
  const noHooks = noHooksDir(host);
  const cwd = worktree.path;
  const [numstat, names, commits] = await Promise.all([
    git(["diff", "--numstat", "-M", worktree.base, "--"], cwd, noHooks),
    git(["diff", "--name-status", "-M", worktree.base, "--"], cwd, noHooks),
    git(["rev-list", "--count", `${worktree.base}..HEAD`], cwd, noHooks),
  ]);
  const counts = parseNumstat(numstat);
  const files: LaneDiffFile[] = [];
  for (const line of names.split("\n")) {
    const [status, ...paths] = line.split("\t");
    if (!status || !paths.length) continue;
    const path = paths.at(-1)!;
    const stat = counts.get(path) ?? { added: 0, removed: 0, binary: false };
    files.push({ path, change: STATUS[status[0]!] ?? "changed", added: stat.added, removed: stat.removed, ...(stat.binary ? { binary: true } : {}),
      ...(status.startsWith("R") && paths.length > 1 ? { from: paths[0] } : {}) });
  }
  let patch = await git(["diff", "-M", "--no-color", "--no-ext-diff", worktree.base, "--"], cwd, noHooks);
  const untracked = (await git(["ls-files", "--others", "--exclude-standard", "-z"], cwd, noHooks)).split("\0").filter(Boolean);
  for (const [index, path] of untracked.entries()) {
    if (index >= UNTRACKED_DIFFED_MAX || patch.length > PATCH_MAX) {
      files.push({ path, change: "added", added: 0, removed: 0 });
      continue;
    }
    const one = await git(["diff", "--no-index", "--no-color", "--no-ext-diff", "--", nullDevice(), path], cwd, noHooks, [0, 1]);
    const added = one.split("\n").filter((line) => line.startsWith("+") && !line.startsWith("+++")).length;
    files.push({ path, change: "added", added, removed: 0, ...(/^Binary files/m.test(one) ? { binary: true } : {}) });
    patch += one;
  }
  const truncated = patch.length > PATCH_MAX || files.length > FILES_MAX;
  return {
    base: worktree.base, branch: worktree.branch, commits: Number(commits.trim()) || 0,
    files: files.slice(0, FILES_MAX), patch: patch.length > PATCH_MAX ? patch.slice(0, patch.lastIndexOf("\n", PATCH_MAX) + 1) : patch, truncated,
  };
}

const nullDevice = () => (process.platform === "win32" ? "NUL" : "/dev/null");

/** The folder goes; the branch stays in the repository with every commit the lane made. */
export async function removeLaneWorktree(host: WorktreeHost, worktree: { path: string; repo: string }): Promise<void> {
  if (!ownLaneFolder(host, worktree.path)) throw new Error("not a mission lane's folder");
  if (!existsSync(worktree.path)) return;
  await git(["worktree", "remove", "--force", "--", worktree.path], worktree.repo, noHooksDir(host));
}
