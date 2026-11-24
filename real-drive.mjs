// node real-drive2.mjs URL BOT FIRST SECOND — sends FIRST, waits for the bot's first row after it, then sends SECOND.
const [url, bot, firstText, secondText] = process.argv.slice(2);
const { execFileSync } = await import("node:child_process");
const j = async (method, path, body, token) => {
  const r = await fetch(url + path, { method, headers: { ...(body ? { "content-type": "application/json" } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}), "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) Safari/605.1" }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const rows = () => JSON.parse(execFileSync("node", ["--experimental-strip-types", "scripts/control-dusk.ts", "messages", "--bot", bot, "--url", url], { encoding: "utf8" })).messages;
const opened = await j("POST", "/api/auth/pairing", {});
const token = (await j("POST", "/api/auth/pair", { code: opened.body.code })).body.token;
const before = rows().length;
console.log("first", (await j("POST", `/api/bots/${bot}/messages`, { text: firstText }, token)).status);
const t0 = Date.now();
for (;;) {
  await new Promise((r) => setTimeout(r, 1000));
  const now = rows().slice(before + 1);
  if (now.some((m) => m.role === "bot")) { console.log("bot moved after", Date.now() - t0, "ms:", now.map((m) => m.kind).join(",")); break; }
  if (Date.now() - t0 > 60000) { console.log("no bot row in 60 s"); break; }
}
const second = await j("POST", `/api/bots/${bot}/messages`, { text: secondText }, token);
console.log("second", second.status, second.body?.steered);
