// the real dashboard (apps/dashboard) on a fixture with a slow-motion panel; nothing here ships.
//   node scripts/dashboard-motion-lab/run.mjs [--port 7561] [--api 7560]
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { createServer } from "vite";

const here = (path) => fileURLToPath(new URL(path, import.meta.url));
const { values } = parseArgs({ options: { port: { type: "string", default: "7561" }, api: { type: "string", default: "7560" }, email: { type: "string", default: "sid@duskbot.test" } } });
const api = `http://127.0.0.1:${values.api}`;

const codes = [];
const fixture = spawn(process.execPath, [here("../../apps/dashboard/scripts/fixture.ts"), "--port", values.api, "--email", values.email, "--demo"], { stdio: ["ignore", "pipe", "inherit"] });
let ready;
const up = new Promise((resolve) => (ready = resolve));
fixture.stdout.on("data", (chunk) => {
  const text = String(chunk);
  process.stdout.write(`[fixture] ${text}`);
  for (const [, to, code] of text.matchAll(/^code for (.*?): (\d+)$/gm)) if (to === values.email) codes.push(code);
  if (text.includes('"signedIn"')) ready();
});
fixture.on("exit", (code) => { console.error(`fixture exited (${code})`); process.exit(1); });
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => { fixture.kill(signal); process.exit(0); });
await up;

async function signIn() {
  const post = (path, body) => fetch(api + path, { method: "POST", headers: { "content-type": "application/json", origin: api }, body: JSON.stringify(body) });
  const seen = codes.length;
  const start = await (await post("/v1/auth/start", { email: values.email })).json();
  for (let i = 0; codes.length === seen && i < 50; i++) await new Promise((r) => setTimeout(r, 50));
  const verify = await post("/v1/auth/verify", { attempt: start.attempt, code: codes.at(-1) });
  if (!verify.ok) throw new Error(`sign in failed: ${verify.status}`);
  const { csrfToken } = await verify.json();
  const cookies = verify.headers.getSetCookie();
  const headers = { "content-type": "application/json", origin: api, cookie: cookies.map((c) => c.split(";")[0]).join("; "), "x-dusk-csrf": csrfToken };
  await fetch(api + "/v1/account", { method: "PATCH", headers, body: JSON.stringify({ name: "Sid" }) });
  await fetch(api + "/v1/account/onboarded", { method: "POST", headers, body: "{}" });
  return cookies;
}

const clock = readFileSync(here("./clock.js"), "utf8");
const lab = {
  name: "dashboard-motion-lab",
  configureServer(server) {
    server.middlewares.use(async (req, res, next) => {
      const html = req.method === "GET" && (req.headers.accept ?? "").includes("text/html");
      if (!html) return next();
      // cookies are per host, not per port: another local dashboard on 127.0.0.1 may have left a session this fixture never issued
      if (req.headers.cookie && (await fetch(api + "/v1/me", { headers: { cookie: req.headers.cookie } })).ok) return next();
      try {
        res.writeHead(302, { "set-cookie": await signIn(), location: req.url });
        res.end();
      } catch (error) { next(error); }
    });
    server.middlewares.use("/__lab/panel.js", (_req, res) => {
      res.setHeader("content-type", "text/javascript");
      res.end(readFileSync(here("./panel.js"), "utf8"));
    });
  },
  transformIndexHtml: () => [
    { tag: "script", children: clock, injectTo: "head-prepend" },
    { tag: "script", attrs: { type: "module", src: "/__lab/panel.js" }, injectTo: "body" },
  ],
};

process.env.DUSK_DASHBOARD_SERVICE = api;
const server = await createServer({
  configFile: here("../../apps/dashboard/vite.config.ts"),
  cacheDir: here("./.vite-cache"),
  server: { port: Number(values.port), strictPort: true },
  plugins: [lab],
});
await server.listen();
console.log(`motion lab: http://127.0.0.1:${values.port}/`);
