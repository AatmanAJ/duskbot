// A fixture server's PATH never reaches this machine's engine CLIs: the engine guard ends a fixture that launches one.
// node often shares its folder with them (~/.local/bin, /opt/homebrew/bin), so it can get a folder of its own.
import { existsSync, mkdirSync, symlinkSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { REAL_ENGINES } from "../engine-guard.ts";

const holdsEngine = (folder: string): boolean =>
  [...REAL_ENGINES].some((name) => ["", ".exe", ".cmd"].some((ext) => existsSync(join(folder, name + ext))));

/** `path` without the folders that hold an engine CLI */
export function pathWithoutEngines(path: string | undefined): string {
  return (path ?? "").split(delimiter).filter((folder) => folder && !holdsEngine(folder)).join(delimiter);
}

/** a folder with this node and no engine CLI: node's own folder, or one under `scratch` with a link to it */
export function nodeOnlyFolder(scratch: string): string {
  const own = dirname(process.execPath);
  if (!holdsEngine(own)) return own;
  const folder = join(scratch, "node-bin");
  const link = join(folder, process.platform === "win32" ? "node.exe" : "node");
  mkdirSync(folder, { recursive: true });
  if (!existsSync(link)) symlinkSync(process.execPath, link);
  return folder;
}

/** the PATH for a fixture server: this node first, then `path` without engine folders */
export function engineFreePath(scratch: string, path?: string): string {
  return [nodeOnlyFolder(scratch), pathWithoutEngines(path)].filter(Boolean).join(delimiter);
}

/** a folder holding only a link to this machine's `git`, for a fixture that works with repositories; null without git */
export function gitOnlyFolder(scratch: string, path: string | undefined): string | null {
  const name = process.platform === "win32" ? "git.exe" : "git";
  const found = (path ?? "").split(delimiter).map((folder) => join(folder, name)).find((candidate) => existsSync(candidate));
  if (!found) return null;
  const folder = join(scratch, "git-bin");
  mkdirSync(folder, { recursive: true });
  if (!existsSync(join(folder, name))) symlinkSync(found, join(folder, name));
  return folder;
}
