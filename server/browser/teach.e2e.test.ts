// Teach a task on real Chrome: the person records, clicks and types in the panel's live stream, and stops; the
// recording names what they acted on, keeps what they typed, and never what went into the password field.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, expect, it } from "vitest";
import { describe } from "vitest";

import type { TeachStatus } from "../../shared/teach-task.ts";
import { json, readBody } from "../harness/http.ts";
import type { RequestAuth } from "../request-auth.ts";
import { createBrowserViewerRoutes } from "../routes/browser-viewers.ts";
import { dispatchRoutes } from "../routes/table.ts";
import { createUpgrades } from "../routes/upgrades.ts";
import { hostTimeout } from "../testing/host-timeout.ts";
import { FixtureServer } from "./cdp/testing/fixtures.ts";
import { CHROME } from "./cdp/testing/real-chrome.ts";
import type { BrowserTarget } from "./service.ts";
import { TeachRecorders } from "./teach.ts";
import { startService, until, type RealService } from "./testing/real-service.ts";
import { StreamV2 } from "./viewers/stream-v2.ts";

const suite = CHROME ? describe : describe.skip;
const LOOPBACK = { kind: "loopback", scopes: ["admin", "client"] } as RequestAuth;

const SHOP = `<!doctype html><title>Tea shop</title><style>body{margin:0}#q{position:absolute;left:20px;top:20px;width:240px;height:30px}#pw{position:absolute;left:20px;top:80px;width:240px;height:30px}#go{position:absolute;left:20px;top:140px;width:120px;height:40px}</style>
<label for="q">Search teas</label><input id="q" type="search" value="old words">
<input id="pw" type="password" aria-label="Shop password">
<button id="go" onclick="location.href='/results?session=abc123'">Find tea</button>`;
const RESULTS = `<!doctype html><title>Results</title><style>body{margin:0}#first{position:absolute;left:20px;top:20px;width:200px;height:30px;display:block}</style><a id="first" href="#">Sencha, 100 g</a>`;

suite("teach a task on real Chrome", () => {
  let fx: FixtureServer;
  let real: RealService;
  let server: Server;
  let origin = "";
  const teach = new TeachRecorders();
  const target: BrowserTarget = { session: "teach-1", key: "bot:teach-1" };

  beforeAll(async () => {
    fx = await FixtureServer.start();
    fx.route("/results", { body: RESULTS, type: "text/html" });
    real = await startService({ screen: { width: 1920, height: 1080, deviceScaleFactor: 1 }, teach });
    const stream = new StreamV2({ service: real.service });
    const upgrades = createUpgrades();
    const route = createBrowserViewerRoutes({
      upgrades,
      dataDir: real.dataDir,
      person: () => "local-owner",
      viewers: {
        teach,
        open: async () => {},
        action: async () => ({ ok: true }),
        stream: ({ session: _session, spec: _spec, ...request }) => { stream.open({ ...request, target }); return true; },
        fileChooserOffered: () => false,
        answerFileChooser: async () => false,
        download: () => undefined,
      },
      audience: () => "team",
      browser: async (botId) => ({ botId, session: target.session, spec: { command: "dusk-cdp", args: [target.key], env: {} } }),
      authorize: async () => null,
      current: () => true,
    });
    const handle = async (req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(req.url ?? "/", "http://localhost");
      if (!await dispatchRoutes([route], { req, res, url, path: url.pathname, method: req.method ?? "GET", auth: LOOPBACK, json, readBody })) json(res, 404, { error: "no route" });
    };
    server = createServer((req, res) => void handle(req, res));
    upgrades.attach(server, handle);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    origin = `127.0.0.1:${(server.address() as AddressInfo).port}`;
  }, hostTimeout(240_000));

  afterAll(async () => {
    await new Promise<void>((resolve) => { if (!server) resolve(); else { server.close(() => resolve()); server.closeAllConnections(); } });
    await real?.close();
    await fx?.close();
  });

  const recording = async (action?: string): Promise<TeachStatus> => {
    const response = await fetch(`http://${origin}/api/bots/pepper/browser/teach`, action
      ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }) } : {});
    expect(response.status).toBe(200);
    return await response.json() as TeachStatus;
  };

  it("records a search, a hidden password and the page a click led to", async () => {
    const opened = await real.call(target, "agent_browser_open", { url: fx.page("/shop", SHOP) });
    expect(opened.isError, real.text(opened)).toBeUndefined();
    const socket = new WebSocket(`ws://${origin}/api/bots/pepper/browser/stream?width=1200&height=800&maxWidth=1200&maxHeight=800`);
    const messages: Array<Record<string, unknown>> = [];
    socket.addEventListener("message", (event) => {
      if (typeof event.data === "string") messages.push(JSON.parse(event.data) as Record<string, unknown>);
      else socket.send("{\"type\":\"ack\"}");
    });
    await new Promise((resolve, reject) => { socket.addEventListener("open", resolve); socket.addEventListener("error", reject); });
    const send = (message: Record<string, unknown>) => socket.send(JSON.stringify(message));
    send({ type: "takeControl" });
    await until(() => messages.filter((message) => message.type === "control").at(-1), (control) => control?.controller === "you");

    expect(await recording("start")).toMatchObject({ recording: true, steps: [] });
    const click = (x: number, y: number) => {
      send({ type: "mouse", action: "down", x, y, button: "left", buttons: 1, clickCount: 1, modifiers: 0 });
      send({ type: "mouse", action: "up", x, y, button: "left", buttons: 0, clickCount: 1, modifiers: 0 });
    };
    const type = (text: string) => { for (const key of text) { send({ type: "key", action: "down", key, code: "", text: key, modifiers: 0 }); send({ type: "key", action: "up", key, code: "", modifiers: 0 }); } };
    click(60, 35);
    type("sencha");
    click(60, 95);
    type("pw-never-kept");
    click(60, 160);
    await until(() => real.peek<string>(target, "location.pathname"), (path) => path === "/results");
    click(60, 35);
    await until(() => recording(), (status) => status.steps.at(-1)?.kind === "click" && status.steps.length >= 7);
    expect(await real.peek<string>(target, "document.getElementById('first') ? 'ok' : ''")).toBe("ok");

    const stopped = await recording("stop");
    expect(stopped).toMatchObject({ recording: false, stopped: "person" });
    expect(JSON.stringify(stopped)).not.toMatch(/pw-never-kept|old words|abc123/);
    expect(stopped.steps).toEqual([
      { kind: "page", url: expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+\/shop$/), title: "Tea shop" },
      { kind: "click", target: { role: "searchbox", name: "Search teas" } },
      { kind: "type", target: { role: "searchbox", name: "Search teas" }, text: "sencha" },
      { kind: "click", target: { role: "textbox", name: "Shop password" } },
      { kind: "type", target: { role: "textbox", name: "Shop password" }, text: "", hidden: true },
      { kind: "click", target: { role: "button", name: "Find tea" } },
      { kind: "page", url: expect.stringMatching(/\/results$/), title: "Results" },
      { kind: "click", target: { role: "link", name: "Sencha, 100 g" } },
    ]);
    expect(await recording("discard")).toEqual({ recording: false, steps: [] });
    socket.close();
  }, hostTimeout(120_000));
});
