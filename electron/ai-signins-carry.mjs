// This computer's AI sign-ins that can go to the person's own Cloud (shared/ai-signins.ts): the CLI logins kept in a
// plain file. Claude Code, Cursor and Copilot keep theirs in the OS keychain, tied to this computer, so they stay.
//
// Security invariant: what is read here goes only to cloudAccount.holdSignIns; never log it.
import { promises as fsp } from "node:fs";
import os from "node:os";
import path from "node:path";

const MAX_BYTES = 32 * 1024;
const KIMI_TOKEN_FILE = /^kimi-code(?:-env-[0-9a-f]{1,64})?\.json$/;

/** The engines (driver kinds) each sign-in signs in, as shared/ai-signins.ts says. */
export const CARRIED_DRIVERS = { "codex-auth": ["codex"], "grok-auth": ["grokAgent"], "gemini-oauth": ["geminiAgent"], "kimi-auth": ["kimiAgent"] };

const files = (env, home) => ({
  "codex-auth": path.join(env.CODEX_HOME || path.join(home, ".codex"), "auth.json"),
  "grok-auth": path.join(env.GROK_HOME || path.join(home, ".grok"), "auth.json"),
  "gemini-oauth": path.join(home, ".gemini", "oauth_creds.json"),
});

async function jsonObject(file, fs) {
  try {
    const text = await fs.readFile(file, "utf8");
    if (!text || Buffer.byteLength(text) > MAX_BYTES) return null;
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? { text, parsed } : null;
  } catch { return null; }
}

/** Kimi Code's login: the first token file that still holds a token (a refused one is kept with both tokens empty). */
async function kimiLogin(env, home, fs) {
  const dir = path.join(env.KIMI_CODE_HOME || path.join(home, ".kimi-code"), "credentials");
  let names = [];
  try { names = (await fs.readdir(dir)).filter((name) => KIMI_TOKEN_FILE.test(name)).sort(); } catch { return null; }
  for (const name of names) {
    const read = await jsonObject(path.join(dir, name), fs);
    if (read && !(read.parsed.access_token === "" && read.parsed.refresh_token === "")) return { kind: "kimi-auth", auth: read.text, file: name };
  }
  return null;
}

/** The sign-ins on this computer that can go to the Cloud, at most one of each kind. */
export async function localAiSignIns({ env = process.env, home = os.homedir(), fs = fsp } = {}) {
  const items = [];
  for (const [kind, file] of Object.entries(files(env, home))) {
    const read = await jsonObject(file, fs);
    if (read) items.push({ kind, auth: read.text });
  }
  const kimi = await kimiLogin(env, home, fs);
  if (kimi) items.push(kimi);
  return items;
}

/** The engines here (instance ids) whose sign-in goes along: those a carried login signs in, and those run on a key
 * the move to the Cloud takes (`keyEngines`, cloud-connections' "key:" items). */
export function carriedEngines(instances, kinds, keyEngines = []) {
  const drivers = new Set(kinds.flatMap((kind) => CARRIED_DRIVERS[kind] ?? []));
  const keys = new Set(keyEngines);
  return (Array.isArray(instances) ? instances : [])
    .filter((instance) => typeof instance?.instanceId === "string" && (drivers.has(instance.driverKind) || keys.has(instance.instanceId)))
    .map((instance) => instance.instanceId);
}
