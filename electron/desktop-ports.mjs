/** The desktop app serves its own page on the first of these that is free; each has its own page storage. */
export const DESKTOP_PORTS = Object.freeze([8799, 18799, 28799]);

/** The phone companion listens here and takes its control port from 8811 up, never the harness's port or its webhook's next to it. */
export const COMPANION_PORT = 8810;
export function companionControlPort(harnessPort) {
  const taken = new Set([COMPANION_PORT, harnessPort, harnessPort + 1]);
  let port = 8811;
  while (taken.has(port)) port += 1;
  return port;
}
