// A script check's output kept in the bot's own folder (RoutineProbe.saveTo). dusk bot writes it, not the script, so the
// script stays in its fence. Security: the file must resolve inside the folder, and a link at its name is never followed.
import { lstatSync, mkdirSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, sep } from "node:path";

import { writeFileAtomic } from "./atomic.ts";
import { wakeAsked } from "./routine-script.ts";
import { workspaceRelative } from "./routine-quiet.ts";

/** An appended file keeps its newest bytes up to this. */
export const SAVED_MAX_BYTES = 1024 * 1024;

/** What a script printed, without a last {"wakeAgent": …} line. */
export function savedText(output: string): string {
  const lines = output.replace(/\s+$/, "").split(/\r?\n/);
  if (wakeAsked(output) !== undefined) lines.pop();
  return lines.join("\n").trim();
}

/** Writes the output, replacing the file or added to its end; null once written (or with nothing to write), else why not. */
export function saveScriptOutput(workspace: string, relative: string, output: string, mode?: "append", now = Date.now()): string | null {
  const text = savedText(output);
  if (!text) return null;
  try {
    const path = workspaceRelative(relative);
    mkdirSync(workspace, { recursive: true, mode: 0o700 });
    const root = realpathSync(workspace);
    const target = join(root, path);
    mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
    const folder = realpathSync(dirname(target));
    if (folder !== root && !folder.startsWith(root + sep)) return "its folder leads outside the bot's own folder";
    let before = "";
    try {
      const stat = lstatSync(target);
      if (!stat.isFile()) return "something other than a plain file has that name";
      if (mode === "append") before = readFileSync(target, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const next = mode === "append" ? `${before}${before && !before.endsWith("\n") ? "\n" : ""}## ${new Date(now).toISOString()}\n${text}\n` : `${text}\n`;
    const bytes = Buffer.from(next, "utf8");
    writeFileAtomic(join(folder, path.split("/").at(-1)!), bytes.length > SAVED_MAX_BYTES ? bytes.subarray(bytes.length - SAVED_MAX_BYTES).toString("utf8") : next, { mode: 0o600 });
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}
