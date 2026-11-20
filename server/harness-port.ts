import type { Server } from "node:net";

/** The port this server's HTTP API listens on. */
export function harnessPort(env: NodeJS.ProcessEnv = process.env): number {
  return Number(env.DUSK_PORT || 8799);
}

export function portTakenMessage(port: number): string {
  return `dusk bot could not start: port ${port} is already in use, most likely by another dusk bot. Stop that one, or start this one with DUSK_PORT set to a free port.`;
}

export function exitWhenPortTaken(server: Server, port: number, exit: (code: number) => void = (code) => process.exit(code)): void {
  server.once("error", (error: NodeJS.ErrnoException) => {
    if (error.code !== "EADDRINUSE") throw error;
    console.error(portTakenMessage(port));
    exit(1);
  });
}
