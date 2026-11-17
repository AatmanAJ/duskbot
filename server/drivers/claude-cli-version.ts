import { parseVersionTriple, versionAtLeast } from "./acp/version-probe.ts";

export type ClaudeCliVersion = readonly [number, number, number];

/** The first Claude CLI to accept each flag; an unknown flag is a hard argument error. Checked
 * against the published binaries (the changelog never records --autocompact): --strict-mcp-config
 * 1.0.60, --setting-sources 1.0.122, --autocompact 2.1.122. */
export const CLAUDE_FLAG_FLOORS = {
  "--strict-mcp-config": [1, 0, 60],
  "--setting-sources": [1, 0, 122],
  "--autocompact": [2, 1, 122],
  "--system-prompt-snapshot": [2, 1, 267],
  // 2.1.248 takes --restricted; 2.1.257 honours blockReadsOutsideWorkingDirectories.
  "--restricted": [2, 1, 257],
  // Keep-warm pings only. Not bisected: both are in every 2.1 build checked.
  "--fork-session": [2, 1, 0],
  "--no-session-persistence": [2, 1, 0],
  // Background calls. Not bisected: the guest path passes it from 2.1.257.
  "--tools": [2, 1, 257],
} as const satisfies Record<string, ClaudeCliVersion>;


/** The first Claude CLI to take `{"type": "http", "url", "headers"}` servers in --mcp-config (streamable HTTP, 1.0.27).
 * An unidentified CLI keeps stdio relays. */
export const CLAUDE_HTTP_MCP_FLOOR: ClaudeCliVersion = [1, 0, 27];

export function claudeCliHttpMcp(version: ClaudeCliVersion | null): boolean {
  return version !== null && versionAtLeast(version, CLAUDE_HTTP_MCP_FLOOR);
}

/** `claude --version` prints "2.1.232 (Claude Code)". */
export function parseClaudeCliVersion(stdout: string | null | undefined): ClaudeCliVersion | null {
  return parseVersionTriple(stdout ?? "");
}

export function claudeCliSupports(version: ClaudeCliVersion | null, flag: keyof typeof CLAUDE_FLAG_FLOORS): boolean {
  return version === null || versionAtLeast(version, CLAUDE_FLAG_FLOORS[flag]);
}
