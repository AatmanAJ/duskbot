import path from "node:path";

import { MANAGED_COMPANION_ORIGIN_PORT } from "./companion-origin-gateway.mjs";
import { defaultCompanionDir } from "./legacy-names.mjs";

/** The desktop app serves its own page on the first of these that is free; each has its own page storage. */
export const DESKTOP_PORTS = Object.freeze([8799, 18799, 28799]);

/**
 * The phone companion's two ports follow its harness: 8810 and 8811 beside 8799, harness + 11 and + 12 beside any other,
 * so two desktop apps on one computer (the packaged app and `pnpm dev:app`) never take each other's. Never the harness's
 * port, its webhook's next to it, or the hosted connector's origin port.
 */
export function companionPorts(harnessPort) {
  const taken = new Set([harnessPort, harnessPort + 1, MANAGED_COMPANION_ORIGIN_PORT]);
  const free = (from, also = -1) => {
    let port = from;
    while (taken.has(port) || port === also) port += 1;
    return port;
  };
  const companion = free(harnessPort + 11);
  return { companion, control: free(companion + 1, companion) };
}

/**
 * The packaged app's companion keeps the person's paired phones in the usual folder; a dev app's gets its own beside it,
 * since each companion holds its devices in memory and writes them whole, and would drop the other app's pairings.
 */
export function companionFolder({ home, harnessPort, packaged }) {
  const folder = defaultCompanionDir(home);
  return packaged ? folder : path.join(folder, `dev-${harnessPort}`);
}
