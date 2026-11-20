import { execFile } from "node:child_process";
import net from "node:net";
import path from "node:path";

const CONNECT_MS = 400;
const REAP_WAIT_MS = 3_000;
const REAP_POLL_MS = 100;

function connects(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port });
    const done = (value) => { socket.destroy(); resolve(value); };
    socket.setTimeout(CONNECT_MS, () => done(false));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
}

function binds(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.listen({ host: "127.0.0.1", port, exclusive: true }, () => server.close(() => resolve(true)));
  });
}

/** Something already answers on 127.0.0.1:port, or this process can't listen there. */
export async function portTaken(port, { connect = connects, bind = binds } = {}) {
  if (await connect(port)) return true;
  return !(await bind(port));
}

/** A port the system says is free right now on 127.0.0.1. */
export function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port: 0, exclusive: true }, () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

const run = (file, args) => new Promise((resolve) => {
  execFile(file, args, { timeout: 3_000 }, (error, stdout) => resolve(error && !stdout ? "" : String(stdout)));
});

/** The folder every process of this install runs from: the .app bundle on macOS, the executable's folder elsewhere. */
export function installRoot(execPath, platform = process.platform) {
  const bundle = platform === "darwin" ? execPath.match(/^(.*?\.app)\//)?.[1] : null;
  return `${bundle ?? path.dirname(execPath)}/`;
}

/**
 * A server left behind by an earlier launch of this same install: an Electron utility process run from this install's
 * folder whose parent is no longer this app. Another copy of the app that is still running keeps its server.
 */
export function strandedServer({ command, parentCommand }, root) {
  if (!command.startsWith(root) || !command.includes("--type=utility")) return false;
  return !parentCommand?.startsWith(root);
}

/** The process listening on the port when it is a stranded server of this install, else null. macOS and Linux only. */
export async function strandedServerOn(port, { execPath, platform = process.platform, exec = run } = {}) {
  if (platform !== "darwin" && platform !== "linux") return null;
  const root = installRoot(execPath, platform);
  const pids = (await exec("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"])).split(/\s+/).map(Number).filter((pid) => pid > 1);
  for (const pid of new Set(pids)) {
    const [ppid, ...rest] = (await exec("ps", ["-o", "ppid=", "-o", "command=", "-p", String(pid)])).trim().split(/\s+/);
    const parent = Number(ppid);
    if (!parent) continue;
    const parentCommand = parent > 1 ? (await exec("ps", ["-o", "command=", "-p", String(parent)])).trim() : "";
    if (strandedServer({ command: rest.join(" "), parentCommand }, root)) return pid;
  }
  return null;
}

/** Stops a stranded server and waits for its port: true once the port is free again. */
export async function reapServer(pid, port, { kill = process.kill.bind(process), taken = portTaken, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), waitMs = REAP_WAIT_MS } = {}) {
  for (const signal of ["SIGTERM", "SIGKILL"]) {
    try { kill(pid, signal); } catch { return !(await taken(port)); }
    for (let waited = 0; waited < waitMs; waited += REAP_POLL_MS) {
      if (!(await taken(port))) return true;
      await sleep(REAP_POLL_MS);
    }
  }
  return !(await taken(port));
}

/**
 * Where the server can start next: the first of `ports` that is free, freeing one held by a stranded server of this
 * install on the way; when every one is held by something else, a port the system picks. `busy` lists the ports skipped.
 */
export async function pickServerPort(ports, { taken = portTaken, stranded = async () => null, reap = reapServer, free = freePort, log = () => {} } = {}) {
  const busy = [];
  for (const port of ports) {
    if (!(await taken(port))) return { port, busy };
    const pid = await stranded(port);
    if (pid && (await reap(pid, port))) {
      log(`stopped a server left by an earlier launch (pid ${pid}) on port ${port}`);
      return { port, busy, reaped: pid };
    }
    log(`port ${port} is in use by another program`);
    busy.push(port);
  }
  return { port: await free(), busy };
}
