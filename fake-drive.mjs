// node drive.mjs URL BOT OUTDIR — start a long turn, then send a second ask as a paired person.
const [url, bot, out] = process.argv.slice(2);
const fs = await import("node:fs");
const j = async (method, path, body, token) => {
  const r = await fetch(url + path, { method, headers: { ...(body ? { "content-type": "application/json" } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}), "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) Safari/605.1" }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const opened = await j("POST", "/api/auth/pairing", {});
const paired = await j("POST", "/api/auth/pair", { code: opened.body.code });
const token = paired.body.token;
const first = await j("POST", `/api/bots/${bot}/messages`, { text: "Redo the Hana email and save it as a Word document." }, token);
console.log("first", first.status, JSON.stringify(first.body).slice(0, 200));
await new Promise((r) => setTimeout(r, 2500));
const second = await j("POST", `/api/bots/${bot}/messages`, { text: "Who are ustwo's two closest competitors in London?" }, token);
console.log("second", second.status, JSON.stringify(second.body).slice(0, 200));
await new Promise((r) => setTimeout(r, 4000));
const bots = await j("GET", "/api/bots", undefined, token);
const b = bots.body.bots.find((x) => x.id === bot);
console.log("busy", b.busy);
