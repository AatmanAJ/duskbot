// The phone apps people already have (iPhone 1.2, Android 1.2.1: their own connection code, scripts/testing/shipped-phone.ts)
// against this tree's desktop side: an isolated harness in desktop mode, the desktop's phone relay supervisor
// (electron/phone-relay.mjs, with the link agent's hub), a link service and the companion sidecar's handler. Pairing by
// QR and typed code, bots, a message and its streamed reply, then the relay down, a link node restart, a harness
// restart, a dropped tunnel, a Wi-Fi-only phone and unpairing from either end, checking where each phone ends up. The
// next phone build (this tree's src/mobile at HEAD) runs beside them, and every launch says how long its walk took: a
// Wi-Fi address the computer no longer holds, the desktop app restarting and the relay coming back are timed too.
//   node --experimental-strip-types scripts/phone-shipped-e2e.ts
// It never touches the live relay or the person's app: everything listens on 127.0.0.1 and lives in temp folders.
//   node --experimental-strip-types scripts/phone-shipped-e2e.ts --prod
// runs the pairing, chat, hub-down fallback and removal through the production link node (https://link.dusk.bot) with a
// test account on the preview account service (phone-e2e@qa.dusk.test: never mailed, its code read from the preview
// test mailbox), and ends the tunnel it made.
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { generateKeyPairSync, randomBytes, randomUUID, sign } from "node:crypto";
import { mkdirSync, mkdtempSync, openSync, closeSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { connect, createServer as createTcpServer, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { createMobileSessions } from "../apps/companion/src/mobile.ts";
import { createProxyHandler } from "../apps/companion/src/proxy.ts";
import { createLinkService } from "../apps/link-service/src/app.mjs";
import { createPhoneRelay, PHONE_RELAY_BASE } from "../electron/phone-relay.mjs";
import { universalPairLink, type MobilePairingResponse } from "../shared/mobile-link.ts";
import { smokeAccount } from "./smoke/account.mjs";
import { waitForExit } from "../server/testing/cleanup.ts";
import { launchVerificationServer, verificationServerArgs, verificationServerEnvironment, type VerificationServer } from "./control-dusk.ts";
import { fakePlatform, loadShippedPhone, SHIPPED_PHONES, type FakePlatform, type PhoneRecord, type PhoneTransport, type ShippedPhone } from "./testing/shipped-phone.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const LINK = join(ROOT, "apps", "link-service");
const OWNER = randomBytes(32).toString("base64url");
const ACCT = "0123456789abcdef0123456789abcdef";
const PROD = process.argv.includes("--prod");

const results: Array<{ step: string; ok: boolean; detail?: string }> = [];
function check(step: string, ok: boolean, detail?: string) {
  results.push({ step, ok, ...(detail ? { detail } : {}) });
  console.log(`${ok ? "ok  " : "FAIL"} ${step}${detail ? `: ${detail}` : ""}`);
  return ok;
}
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function until<T>(what: () => T | Promise<T>, ms: number): Promise<T | null> {
  const end = Date.now() + ms;
  for (;;) {
    const value = await what();
    if (value) return value;
    if (Date.now() > end) return null;
    await sleep(150);
  }
}
const listen = (server: Server, port = 0) => new Promise<number>((resolve, reject) => {
  server.once("error", reject);
  server.listen(port, "127.0.0.1", () => resolve((server.address() as { port: number }).port));
});
const shut = async (server: Server) => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); };

function grantSigner() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    keys: [{ kid: "e2e", x: publicKey.export({ format: "jwk" }).x! }],
    grant() {
      const iat = Date.now();
      const payload = Buffer.from(JSON.stringify({ v: 1, aud: "link", acct: ACCT, iat, exp: iat + 5 * 60_000 })).toString("base64url");
      return `l1.e2e.${payload}.${sign(null, Buffer.from(`l1.e2e.${payload}`), privateKey).toString("base64url")}`;
    },
  };
}

/** the link node: stopped and started again on the same port and state folder, as a redeploy does */
async function linkNode(dataDir: string, keys: Array<{ kid: string; x: string }>) {
  let port = 0;
  let service: ReturnType<typeof createLinkService>;
  let server: Server;
  const start = async () => {
    service = createLinkService({ base: "http://link.e2e", dataDir, scriptPath: join(LINK, "install.sh"), agentPath: join(LINK, "agent.mjs"), trustProxy: false, grantKeys: keys });
    server = createServer((req, res) => void service.handler(req, res));
    port = await listen(server, port);
  };
  await start();
  return {
    base: () => `http://127.0.0.1:${port}`,
    store: () => service.store,
    async stop() { await shut(server); service.close(); },
    start,
  };
}

/** the isolated harness in desktop mode, restartable on the same folder and port */
async function harness() {
  const parentEnv = { ...process.env, DUSK_TEST_DESKTOP_OWNER_TOKEN: OWNER };
  // the launcher's own setup calls go as the desktop app's window would; nothing else runs while it does
  const realFetch = globalThis.fetch;
  globalThis.fetch = (input, init = {}) => realFetch(input, { ...init, headers: { ...Object.fromEntries(new Headers(init.headers)), "x-dusk-desktop-owner": OWNER } });
  let fixture: VerificationServer;
  try { fixture = await launchVerificationServer(parentEnv); } finally { globalThis.fetch = realFetch; }
  const url = fixture.info.url, port = Number(new URL(url).port), dataDir = fixture.info.dataDir;
  let child: ChildProcess = fixture.child;
  return {
    url, port,
    async stop() { await waitForExit(child, { signal: "SIGTERM" }); },
    async start() {
      const env = verificationServerEnvironment(parentEnv, dataDir, port);
      const log = openSync(join(tmpdir(), `phone-shipped-e2e-harness-${process.pid}.log`), "a", 0o600);
      child = spawn(process.execPath, verificationServerArgs(env), { cwd: ROOT, env, stdio: ["ignore", log, log] });
      closeSync(log);
      return Boolean(await until(() => fetch(`${url}/api/health`).then((res) => res.ok, () => false), 30_000));
    },
    async close() { await waitForExit(child, { signal: "SIGTERM" }); await fixture.close(); },
  };
}

async function owner(base: string, method: string, path: string, body?: unknown) {
  const response = await fetch(`${base}${path}`, {
    method, headers: { "x-dusk-desktop-owner": OWNER, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30_000),
  });
  return { status: response.status, body: await response.json().catch(() => null) as any };
}

/** what the phone app asks through whichever route connectToWorkspace gave it */
function phoneRequest(transport: PhoneTransport, method: string, path: string, body?: unknown, accept?: string): Promise<Response> {
  const headers: Record<string, string> = { authorization: `Bearer ${transport.token}`, ...(body === undefined ? {} : { "content-type": "application/json" }), ...(accept ? { accept } : {}) };
  const bytes = body === undefined ? null : new TextEncoder().encode(JSON.stringify(body));
  if (transport.kind === "relay") return transport.channel.request(method, path, headers, bytes, accept ? undefined : AbortSignal.timeout(20_000));
  return fetch(`${transport.origin}${path}`, { method, headers, body: bytes, ...(accept ? {} : { signal: AbortSignal.timeout(20_000) }) });
}

function events(transport: PhoneTransport) {
  const frames: any[] = [];
  const stop = new AbortController();
  void (async () => {
    const response = await phoneRequest(transport, "GET", "/api/events?screens=off", undefined, "text/event-stream");
    const reader = response.body!.getReader();
    stop.signal.addEventListener("abort", () => void reader.cancel().catch(() => {}));
    const decoder = new TextDecoder();
    let text = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
      for (let at = text.indexOf("\n\n"); at >= 0; at = text.indexOf("\n\n")) {
        const data = text.slice(0, at).split("\n").filter((line) => line.startsWith("data: ")).map((line) => line.slice(6)).join("\n");
        text = text.slice(at + 2);
        if (data) { try { frames.push(JSON.parse(data)); } catch { /* a comment */ } }
      }
    }
  })().catch(() => {});
  return { frames, close: () => stop.abort() };
}

interface Phone { name: string; shipped: ShippedPhone; platform: FakePlatform; record: PhoneRecord; token: string }

/** how long each phone's last walk took */
const walked = new Map<string, number>();

/** the gate's own decision on launch: a route, or "refused" (it unpairs itself), or "unreachable" (it keeps the link) */
async function launch(phone: Phone): Promise<PhoneTransport | "refused" | "unreachable" | string> {
  const started = Date.now();
  try {
    return await phone.shipped.connectToWorkspace(phone.record, phone.token, phone.platform, AbortSignal.timeout(90_000));
  } catch (error) {
    return error instanceof phone.shipped.PairError ? (error as { code: string }).code : `error ${(error as Error).message}`;
  } finally {
    walked.set(phone.name, Date.now() - started);
  }
}

/** a computer's old Wi-Fi address that a phone still has: something takes the connection there and never answers */
async function silentAddress() {
  const held = new Set<Socket>();
  const server = createTcpServer((socket) => { held.add(socket); socket.on("error", () => {}); });
  const port = await new Promise<number>((resolve) => server.listen(0, "127.0.0.1", () => resolve((server.address() as { port: number }).port)));
  return { url: `http://127.0.0.1:${port}`, close: () => { for (const socket of held) socket.destroy(); return new Promise((resolve) => server.close(resolve)); } };
}
/** a slow mobile link in front of `target`: every chunk each way arrives `ms` late, in order */
async function slowLink(target: string, ms: number) {
  const to = new URL(target);
  const held = new Set<Socket>();
  const late = (from: Socket, into: Socket) => {
    let last = 0;
    from.on("data", (chunk) => { last = Math.max(Date.now() + ms, last); setTimeout(() => { if (!into.destroyed) into.write(chunk); }, last - Date.now()); });
    from.on("end", () => setTimeout(() => into.end(), Math.max(0, last - Date.now())));
  };
  const server = createTcpServer((socket) => {
    const upstream = connect(Number(to.port), to.hostname);
    for (const one of [socket, upstream]) { held.add(one); one.on("error", () => { socket.destroy(); upstream.destroy(); }); one.on("close", () => held.delete(one)); }
    late(socket, upstream);
    late(upstream, socket);
  });
  const port = await new Promise<number>((resolve) => server.listen(0, "127.0.0.1", () => resolve((server.address() as { port: number }).port)));
  return { url: `http://127.0.0.1:${port}`, close: () => { for (const socket of held) socket.destroy(); return new Promise((resolve) => server.close(resolve)); } };
}
const routeOf = (outcome: Awaited<ReturnType<typeof launch>>) => (typeof outcome === "string" ? outcome : outcome.kind === "relay" ? "relay" : `bearer ${outcome.origin}`);
const closeRoute = (outcome: Awaited<ReturnType<typeof launch>>) => { if (typeof outcome !== "string" && outcome.kind === "relay") outcome.channel.close(); };

async function chat(label: string, transport: PhoneTransport, botId: string) {
  const bots = await phoneRequest(transport, "GET", "/api/bots?messages=0");
  const list = await bots.json().catch(() => null) as { bots?: Array<{ id: string }> } | null;
  check(`${label}: list bots`, bots.status === 200 && Boolean(list?.bots?.some((bot) => bot.id === botId)), `${bots.status}, ${list?.bots?.length ?? 0} bots`);
  const stream = events(transport);
  const hello = await until(() => stream.frames.find((frame) => frame.kind === "hello"), 15_000);
  check(`${label}: event stream opens`, Boolean(hello));
  const words = `hello from ${label} ${randomUUID().slice(0, 6)}`;
  const sent = await phoneRequest(transport, "POST", `/api/bots/${botId}/messages`, { text: words, sendId: randomUUID() });
  check(`${label}: send a message`, sent.status < 300, `${sent.status}`);
  const mine = await until(() => stream.frames.find((frame) => frame.kind === "message" && frame.message?.role === "user" && String(frame.message?.text ?? "").includes(words)), 20_000);
  const reply = await until(() => stream.frames.find((frame) => frame.kind === "message" && frame.message?.role === "bot" && frame.threadId === mine?.threadId && String(frame.message?.text ?? "").length > 0), 60_000);
  check(`${label}: the bot's reply streams in`, Boolean(reply), reply ? String(reply.message.text).slice(0, 50) : `kinds ${[...new Set(stream.frames.map((frame) => frame.kind))].join(",")}`);
  stream.close();
}

async function main() {
  const scratch = mkdtempSync(join(tmpdir(), "phone-shipped-e2e-"));
  const cleanups: Array<() => unknown> = [() => rmSync(scratch, { recursive: true, force: true })];
  try {
    const head = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
    const builds = { ios: await loadShippedPhone(ROOT, SHIPPED_PHONES.ios, join(scratch, "phones")), android: await loadShippedPhone(ROOT, SHIPPED_PHONES.android, join(scratch, "phones")), next: await loadShippedPhone(ROOT, head, join(scratch, "phones")) };
    check("load the shipped phone code (iPhone 1.2 and Android 1.2.1) and the next build's", true, `${SHIPPED_PHONES.ios}, ${SHIPPED_PHONES.android}, ${head}`);

    const desk = await harness();
    cleanups.push(() => desk.close());
    const bot = await owner(desk.url, "POST", "/api/bots", { name: "Probe" });
    const botId: string = bot.body?.bot?.id;
    check("harness in desktop mode makes a bot for the owner", bot.status < 300 && typeof botId === "string", `${bot.status}`);

    const signer = grantSigner();
    let link: Awaited<ReturnType<typeof linkNode>>;
    let linkGrant: () => Promise<string | null>;
    if (PROD) {
      mkdirSync(join(scratch, "account"), { recursive: true });
      const account = await smokeAccount({ root: ROOT, profile: join(scratch, "account"), email: "phone-e2e@qa.dusk.test" });
      check("a test account signs in on the preview account service", account.state.status === "connected", account.how);
      linkGrant = () => account.client.linkGrant();
      link = { base: () => PHONE_RELAY_BASE, store: () => { throw new Error("production has no local store"); }, stop: async () => {}, start: async () => {} };
    } else {
      link = await linkNode(join(scratch, "link"), signer.keys);
      cleanups.push(() => link.stop().catch(() => {}));
      linkGrant = async () => signer.grant();
    }

    const mobile = createMobileSessions({ file: join(scratch, "companion", "mobile-sessions.json") });
    const proxy = createProxyHandler({ harnessPort: desk.port, mobile, authenticate: () => null, redeem: () => ({ error: "not here" }), serverName: () => "E2E Mac" });
    const companionServer = createServer(proxy);
    companionServer.on("upgrade", proxy.upgrade);
    const companion = `http://127.0.0.1:${await listen(companionServer)}`;
    cleanups.push(() => shut(companionServer));

    const kept = new Map<string, unknown>();
    const deskRelay = () => createPhoneRelay({
      base: link.base(), wanted: () => true, signedIn: () => true, linkGrant, label: () => "E2E Mac phones",
      store: { read: async (at: string) => structuredClone(kept.get(at) ?? null), write: async (at: string, value: unknown) => { kept.set(at, structuredClone(value)); } },
      loadHub: () => import("../apps/link-service/agent.mjs"), port: () => desk.port, ownerToken: () => OWNER, scope: () => "e2e",
      checkMs: 500, retryMs: [300, 1000], log: (line: string) => { if (process.env.E2E_VERBOSE) console.log(`  [desk] ${line}`); },
    });
    let relay = deskRelay();
    relay.start();
    cleanups.push(() => relay.stop());
    const tunnel = () => (kept.get("e2e") as { tunnel?: { id: string; token: string; base: string } } | undefined)?.tunnel ?? null;
    check("the desktop makes its tunnel and the hub comes up", (await relay.ready(15_000)).status === "ready", JSON.stringify(relay.state()));
    // the tunnel this run made is ended whatever happens, so it never holds one of the account's slots
    cleanups.push(async () => {
      const made = tunnel();
      if (!PROD || !made) return;
      relay.stop();
      const ended = await fetch(`${made.base}/v1/tunnels/${made.id}`, { method: "DELETE", headers: { authorization: `Bearer ${made.token}` }, signal: AbortSignal.timeout(15_000) }).then((res) => res.status, () => 0);
      const after = await fetch(`${made.base}/v1/tunnels/${made.id}/node`, { headers: { authorization: `Bearer ${made.token}` }, signal: AbortSignal.timeout(15_000) }).then((res) => res.status, () => 0);
      check(`the production tunnel ${made.id} is ended`, ended === 200 && after === 404, `DELETE ${ended}, then ${after}`);
    });

    const pair = async (name: string, kind: "ios" | "android", how: "qr" | "code", expect: "relay" | "companion", build: "shipped" | "next" = "shipped"): Promise<Phone | null> => {
      if (expect === "relay") await relay.ready(15_000);
      const offer = await owner(desk.url, "POST", "/api/mobile/pairing", { companion: [{ url: companion, kind: "lan", priority: 0 }] });
      const body = offer.body as MobilePairingResponse;
      const kinds = offer.status === 200 ? body.payload.via.map((one) => one.kind).join(",") : `${offer.status} ${JSON.stringify(offer.body)}`;
      check(`${name}: the desktop's code carries ${expect === "relay" ? "relay first, then Wi-Fi" : "Wi-Fi only"}`, offer.status === 200 && kinds === (expect === "relay" ? "relay,companion" : "companion"), kinds);
      if (offer.status !== 200) return null;
      const shipped = build === "next" ? builds.next : builds[kind], platform = fakePlatform(kind, name);
      let payload: unknown;
      if (how === "qr") payload = shipped.readScanned(universalPairLink(body.link, body.code))?.payload;
      else payload = await shipped.resolveTypedCode(body.code!, link.base()).catch((error: Error) => { check(`${name}: typed code resolves`, false, error.message); return null; });
      if (!payload) { check(`${name}: reads the ${how}`, false); return null; }
      const paired = await shipped.redeemPairing(payload, platform).catch((error: Error & { code?: string }) => { check(`${name}: pairs`, false, error.code ?? error.message); return null; });
      if (!paired) return null;
      await shipped.createConnectionStore(platform).save(paired.record, paired.token);
      // the next build pairs over the Wi-Fi address when it answers first, and still takes its relay channel
      const over = build === "next" && expect === "relay" ? ["relay", "companion"].includes(paired.record.transport) : paired.record.transport === expect;
      check(`${name}: pairs by ${how} over ${paired.record.transport}`, over && (expect !== "relay" || Boolean(paired.record.relay?.agentPub)), `${paired.record.transport}, device ${paired.record.deviceId}`);
      return { name, shipped, platform, record: paired.record, token: paired.token };
    };
    const expectRoute = async (phone: Phone, label: string, want: (route: string) => boolean, chatWith = false) => {
      const outcome = await launch(phone);
      const ok = check(`${phone.name}: ${label}`, want(routeOf(outcome)), `${routeOf(outcome)} in ${walked.get(phone.name)}ms`);
      if (ok && chatWith && typeof outcome !== "string") await chat(phone.name, outcome, botId);
      closeRoute(outcome);
      return outcome;
    };
    const onRelay = (route: string) => route === "relay";
    const onCompanion = (route: string) => route === `bearer ${companion}`;
    const notUnpaired = (route: string) => route !== "refused";
    const connected = (route: string) => onRelay(route) || onCompanion(route);

    // first pairs, both builds, two phones on one computer
    const iphone = await pair("iPhone 1.2", "ios", "qr", "relay");
    const android = await pair("Android 1.2.1", "android", "code", "relay");
    if (!iphone || !android) throw new Error("pairing failed; the rest needs both phones");
    await expectRoute(iphone, "opens on the relay and chats", onRelay, true);
    await expectRoute(android, "opens on the relay and chats", onRelay, true);
    const devices = await owner(desk.url, "GET", "/api/mobile/devices");
    check("the desktop lists both phones, each on the relay", devices.body?.devices?.filter((device: { relay: boolean }) => device.relay).length === 2, `${devices.body?.devices?.length}`);
    // the next build: Wi-Fi first where it answers, the relay raced right behind
    const nextPhone = PROD ? null : await pair("iPhone next", "ios", "qr", "relay", "next");
    if (nextPhone) await expectRoute(nextPhone, "opens and chats", connected, true);

    if (PROD) {
      // the computer's hub down (the app quit or asleep) while link.dusk.bot stays up: the phones' frames wait unread
      relay.stop();
      await expectRoute(iphone, "hub down: falls back to Wi-Fi and is not unpaired", onCompanion, true);
      await expectRoute(android, "hub down: falls back to Wi-Fi and is not unpaired", onCompanion);
      relay.start();
      check("the hub comes back on the same tunnel", (await relay.ready(15_000)).status === "ready", JSON.stringify(relay.state()));
      const back = await until(async () => (await launch(iphone).then((outcome) => { const route = routeOf(outcome); closeRoute(outcome); return route === "relay"; })), 60_000);
      check("iPhone 1.2: back on the relay", Boolean(back));
      for (const phone of [iphone, android]) {
        const removed = await owner(desk.url, "DELETE", `/api/mobile/devices/${phone.record.deviceId}`);
        check(`the desktop removes ${phone.name}`, removed.status === 200, `${removed.status}`);
        await expectRoute(phone, "removed on the desktop: unpairs", (route) => route === "refused");
      }
      return;
    }

    // a slow mobile link to the relay (every chunk 400 ms late each way): the phones still open and chat over it
    const slow = await slowLink(link.base(), Number(process.env.E2E_SLOW_MS ?? 400));
    cleanups.push(() => slow.close());
    const overSlowLink = (phone: Phone): Phone => ({ ...phone, record: { ...phone.record, ...(phone.record.relay ? { relay: { ...phone.record.relay, base: slow.url } } : {}), via: (phone.record.via ?? []).flatMap((route) => route.kind === "relay" ? [{ ...route, base: slow.url }] : []) } });
    for (const phone of [iphone, android, ...(nextPhone ? [nextPhone] : [])]) await expectRoute(overSlowLink(phone), "a slow link to the relay: opens on it and chats", onRelay, true);

    // the Mac's Wi-Fi address changed: each phone still holds the old one, which takes the connection and never answers
    const old = await silentAddress();
    cleanups.push(() => old.close());
    const withOldAddress = (phone: Phone): Phone => ({ ...phone, record: { ...phone.record, via: (phone.record.via ?? []).flatMap((route) => route.kind === "companion" ? [{ ...route, url: old.url }, route] : [route]) } });
    for (const phone of [iphone, android, ...(nextPhone ? [nextPhone] : [])]) await expectRoute(withOldAddress(phone), "the Mac's old Wi-Fi address goes silent: still opens at once", connected);

    // the desktop app restarts (an update): the same tunnel and keys come back and so do the phones
    const before = tunnel()?.id;
    relay.stop();
    relay = deskRelay();
    relay.start();
    check("the desktop app starts again on the same tunnel", (await relay.ready(15_000)).status === "ready" && tunnel()?.id === before, `${tunnel()?.id}`);
    await expectRoute(iphone, "back on the relay after the desktop app restarts", onRelay);
    await expectRoute(android, "back on the relay after the desktop app restarts", onRelay, true);

    // the relay down: the shipped apps walk on to the computer's Wi-Fi address, which never saw these sessions
    await link.stop();
    await expectRoute(iphone, "relay down: falls back to Wi-Fi and is not unpaired", onCompanion, true);
    await expectRoute(android, "relay down: falls back to Wi-Fi and is not unpaired", onCompanion);
    check("the companion now knows both relay-paired phones", mobile.has(iphone.token) && mobile.has(android.token));
    if (nextPhone) await expectRoute(nextPhone, "relay down: on Wi-Fi", onCompanion, true);
    // relay down and the old Wi-Fi address first: the shipped builds wait out the silent one, the next build does not
    await expectRoute(withOldAddress(iphone), "relay down, old Wi-Fi address first: reaches the new one", onCompanion);
    if (nextPhone) await expectRoute(withOldAddress(nextPhone), "relay down, old Wi-Fi address first: reaches the new one", onCompanion);

    // a phone pairing while the relay is down gets the Wi-Fi route alone
    const wifiOnly = await pair("Android 1.2.1 (Wi-Fi only)", "android", "qr", "companion");

    // the link node restarts on its saved state
    await link.start();
    const back = await until(async () => (await launch(iphone).then((outcome) => { const route = routeOf(outcome); closeRoute(outcome); return route === "relay"; })), 60_000);
    check("iPhone 1.2: back on the relay after the link node restarts", Boolean(back), `${walked.get("iPhone 1.2")}ms for the last walk`);
    await expectRoute(android, "back on the relay after the link node restarts", onRelay);

    // the harness restarts: unreachable meanwhile, never unpaired, and the same session works after
    await desk.stop();
    await expectRoute(iphone, "harness down: unreachable, still paired", (route) => route === "unreachable");
    if (nextPhone) await expectRoute(nextPhone, "harness down: unreachable, still paired", (route) => route === "unreachable");
    await expectRoute(android, "harness down: unreachable, still paired", (route) => route === "unreachable");
    check("the harness starts again on the same workspace", await desk.start());
    const afterRestart = await until(async () => (await launch(iphone).then((outcome) => { const route = routeOf(outcome); closeRoute(outcome); return route === "relay"; })), 60_000);
    check("iPhone 1.2: back on the relay with its same session after the harness restart", Boolean(afterRestart));
    await expectRoute(android, "back after the harness restart, and chats", onRelay, true);
    if (nextPhone) await expectRoute(nextPhone, "back after the harness restart, and chats", connected, true);

    // the tunnel dropped by the link service (the sweep of a computer that was off): Wi-Fi meanwhile, then the same
    // phones on a new tunnel with the same channels and keys
    const first = tunnel();
    const dropped = first ? await fetch(`${first.base}/v1/tunnels/${first.id}`, { method: "DELETE", headers: { authorization: `Bearer ${first.token}` } }) : null;
    check("the link service drops the desktop's tunnel", dropped?.status === 200, `${dropped?.status}`);
    await expectRoute(iphone, "tunnel gone: walks on to Wi-Fi, not unpaired", notUnpaired);
    const remade = await until(() => { const now = tunnel(); return now && now.id !== first?.id && link.store().channels.get(iphone.record.relay!.channel)?.tunnel === now.id ? now : null; }, 30_000);
    check("the desktop makes a new tunnel and brings the phones' channels over", Boolean(remade), remade?.id);
    await expectRoute(iphone, "on the relay again through the new tunnel", onRelay, true);
    await expectRoute(android, "on the relay again through the new tunnel", onRelay);

    // removed on the desktop: the phone hears it (relay channel gone) and unpairs
    if (wifiOnly) {
      await expectRoute(wifiOnly, "Wi-Fi-only phone opens on Wi-Fi and chats", onCompanion, true);
      const removed = await owner(desk.url, "DELETE", `/api/mobile/devices/${wifiOnly.record.deviceId}`);
      check("the desktop removes the Wi-Fi-only phone", removed.status === 200, `${removed.status}`);
      await expectRoute(wifiOnly, "removed on the desktop: unpairs over Wi-Fi", (route) => route === "refused");
    }
    if (nextPhone) {
      const gone = await owner(desk.url, "DELETE", `/api/mobile/devices/${nextPhone.record.deviceId}`);
      check("the desktop removes the next build's iPhone", gone.status === 200, `${gone.status}`);
      await expectRoute(nextPhone, "removed on the desktop: unpairs", (route) => route === "refused");
    }
    const removed = await owner(desk.url, "DELETE", `/api/mobile/devices/${iphone.record.deviceId}`);
    check("the desktop removes the iPhone", removed.status === 200, `${removed.status}`);
    await expectRoute(iphone, "removed on the desktop: unpairs", (route) => route === "refused");
    check("the companion forgot the removed iPhone", !mobile.has(iphone.token) || (await fetch(`${companion}/api/auth/session`, { headers: { authorization: `Bearer ${iphone.token}` } })).status !== 200);

    // the API a phone uses to remove itself (1.2 and 1.2.1 have no button for it: deleting the app is how a person does it)
    const own = await launch(android);
    if (typeof own !== "string") {
      // the channel can go before its answer does: the removal is checked on the desktop either way
      const gone = await phoneRequest(own, "DELETE", `/api/mobile/devices/${android.record.deviceId}`).then(async (response) => { await response.text().catch(() => ""); return String(response.status); }, (error: Error) => error.name);
      check("Android 1.2.1: removes itself from the phone", gone === "200" || gone === "RelayGoneError", gone);
      closeRoute(own);
    } else check("Android 1.2.1: removes itself from the phone", false, own);
    const left = await owner(desk.url, "GET", "/api/mobile/devices");
    check("the desktop lists no phones", Array.isArray(left.body?.devices) && left.body.devices.length === 0, `${left.body?.devices?.length}`);
    await expectRoute(android, "after removing itself it opens on pairing", (route) => route === "refused");
  } finally {
    for (const cleanup of cleanups.reverse()) { try { await cleanup(); } catch { /* best effort */ } }
  }
}

// a phone app's relay fails what it still had in flight when its channel goes, unawaited; the web view only logs that
process.on("unhandledRejection", (error: Error) => { if (error?.name !== "RelayGoneError") throw error; });
await main().catch((error: Error) => check("the run finished", false, error.stack ?? String(error)));
const failed = results.filter((result) => !result.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
