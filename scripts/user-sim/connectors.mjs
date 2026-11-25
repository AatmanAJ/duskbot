// Stateful stand-ins for a person's connected apps: one stdio MCP server per app (`node connectors.mjs <app>`), all
// reading and writing one JSON state file (APP_STATE), so every send, invite, post, comment and refund is ground truth.
// `state.faults[tool] = { times, error }` makes the next `times` calls of a tool fail with `error`, as a flaky upstream
// would. Standard library only; newline-delimited JSON-RPC as MCP stdio.
import { readFileSync, writeFileSync, renameSync } from "node:fs";
import { createInterface } from "node:readline";

const app = process.argv[2];
const statePath = process.env.APP_STATE;
if (!app || !statePath) { process.stderr.write("usage: APP_STATE=<file> node connectors.mjs <app>\n"); process.exit(2); }

const load = () => JSON.parse(readFileSync(statePath, "utf8"));
const save = (state) => { const tmp = `${statePath}.${process.pid}.tmp`; writeFileSync(tmp, JSON.stringify(state, null, 1)); renameSync(tmp, statePath); };
const now = () => new Date().toISOString();
const id = (prefix) => `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
const log = (s, action, detail) => { (s.log ??= []).push({ at: now(), app, action, ...detail }); };
const str = { type: "string" };
const int = { type: "integer" };
const strs = { type: "array", items: str };
const read = { readOnlyHint: true };
const write = { readOnlyHint: false, destructiveHint: false };
const outward = { readOnlyHint: false, destructiveHint: false, openWorldHint: true };
const lc = (v) => String(v ?? "").toLowerCase();
const has = (hay, q) => !q || lc(hay).includes(lc(q));
const must = (v, what) => { if (!v) throw new Error(`no such ${what}`); return v; };

function matchMail(m, q) {
  if (!q) return true;
  const terms = q.match(/(\w+:"[^"]*"|"[^"]*"|\S+)/g) ?? [];
  return terms.every((raw) => {
    const t = raw.replaceAll('"', "").toLowerCase();
    if (t.startsWith("from:")) return lc(m.from).includes(t.slice(5));
    if (t.startsWith("to:")) return lc(m.to).includes(t.slice(3));
    if (t.startsWith("label:")) return (m.labels ?? []).some((l) => lc(l) === t.slice(6));
    if (t === "is:unread") return !m.read;
    if (t === "is:read") return !!m.read;
    if (t === "has:attachment") return (m.attachments ?? []).length > 0;
    if (t.startsWith("after:")) return Date.parse(m.date) >= Date.parse(t.slice(6).replaceAll("/", "-"));
    if (t.startsWith("before:")) return Date.parse(m.date) < Date.parse(t.slice(7).replaceAll("/", "-"));
    if (t.startsWith("newer_than:")) { const n = parseInt(t.slice(11)); const ms = t.at(-1) === "h" ? 3.6e6 : 8.64e7; return Date.now() - Date.parse(m.date) <= n * ms; }
    if (t.startsWith("subject:")) return lc(m.subject).includes(t.slice(8));
    return lc(`${m.from} ${m.to} ${m.subject} ${m.body} ${(m.labels ?? []).join(" ")}`).includes(t);
  });
}
const threadOf = (s, messageId) => { if (!messageId) return undefined; const m = [...(s.mail ?? []), ...(s.sent ?? [])].find((one) => one.id === messageId); return m ? m.threadId ?? m.id : undefined; };
const brief = (m) => ({ id: m.id, threadId: m.threadId ?? m.id, from: m.from, to: m.to, subject: m.subject, date: m.date, unread: !m.read, labels: m.labels ?? [], snippet: String(m.body).slice(0, 160), attachments: (m.attachments ?? []).map((a) => a.name) });
const sendMail = (s, x) => { const e = { id: id("sent"), from: s.profile?.email, ...x, at: now() }; e.threadId = threadOf(s, x.reply_to_message_id) ?? e.id; (s.sent ??= []).push(e); log(s, "send", { to: x.to, subject: x.subject }); return { message_id: e.id, thread_id: e.threadId, status: "sent" }; };

const overlaps = (s, start, end, except) => (s.events ?? []).filter((e) => e.id !== except && Date.parse(e.start) < Date.parse(end) && Date.parse(e.end) > Date.parse(start)).map((e) => ({ id: e.id, title: e.title, start: e.start, end: e.end }));

const APPS = {
  gmail: {
    gmail_get_profile: { d: "The connected account: its address and the addresses it can send as.", a: read, s: {}, run: (s) => ({ email: s.profile?.email, name: s.profile?.name, send_as: [s.profile?.email, ...(s.profile?.aliases ?? [])].filter(Boolean) }) },
    gmail_search: { d: "Search the inbox. Gmail query syntax: from:, to:, subject:, label:, is:unread, has:attachment, after:YYYY/MM/DD, newer_than:2d, plain words. Newest first.", a: read, s: { query: str, max_results: int },
      run: (s, x) => s.mail.filter((m) => matchMail(m, x.query)).sort((a, b) => Date.parse(b.date) - Date.parse(a.date)).slice(0, x.max_results ?? 25).map(brief) },
    gmail_read: { d: "Read one email in full, with its attachments' text.", a: read, s: { message_id: str }, req: ["message_id"],
      run: (s, x) => { const m = must(s.mail.find((m) => m.id === x.message_id) ?? (s.sent ?? []).find((m) => m.id === x.message_id), "message"); m.read = true; return { ...brief(m), body: m.body, attachments: m.attachments ?? [] }; } },
    gmail_create_draft: { d: "Create a draft (optionally a reply in a thread). It is not sent.", a: write, s: { to: str, cc: str, subject: str, body: str, reply_to_message_id: str }, req: ["to", "subject", "body"],
      run: (s, x) => { const d = { id: id("draft"), ...x, at: now() }; (s.drafts ??= []).push(d); log(s, "draft", { to: x.to, subject: x.subject }); return { draft_id: d.id, status: "draft saved" }; } },
    gmail_send: { d: "Send an email now (optionally as a reply in a thread).", a: outward, s: { to: str, cc: str, subject: str, body: str, reply_to_message_id: str }, req: ["to", "subject", "body"], run: (s, x) => sendMail(s, x) },
    gmail_send_draft: { d: "Send a draft that was created earlier.", a: outward, s: { draft_id: str }, req: ["draft_id"],
      run: (s, x) => { const i = (s.drafts ?? []).findIndex((d) => d.id === x.draft_id); if (i < 0) throw new Error("no such draft"); const [d] = s.drafts.splice(i, 1); const { id: _id, at: _at, ...rest } = d; return sendMail(s, rest); } },
    gmail_list_drafts: { d: "List drafts waiting to be sent.", a: read, s: {}, run: (s) => (s.drafts ?? []).map(({ id, to, subject, at }) => ({ id, to, subject, at })) },
    gmail_list_sent: { d: "List sent mail, newest first.", a: read, s: { query: str }, run: (s, x) => (s.sent ?? []).filter((e) => has(JSON.stringify(e), x.query)).slice(-50).reverse().map(({ id, threadId, to, subject, at }) => ({ id, threadId, to, subject, at })) },
    gmail_modify: { d: "Add or remove labels on a message; mark it read or unread; archive by removing INBOX.", a: write, s: { message_id: str, add_labels: strs, remove_labels: strs, mark_read: { type: "boolean" } }, req: ["message_id"],
      run: (s, x) => { const m = must(s.mail.find((m) => m.id === x.message_id), "message"); m.labels = [...new Set([...(m.labels ?? []).filter((l) => !(x.remove_labels ?? []).includes(l)), ...(x.add_labels ?? [])])]; if (x.mark_read !== undefined) m.read = x.mark_read; log(s, "modify", { message_id: m.id, labels: m.labels }); return { ok: true, labels: m.labels }; } },
  },
  google_calendar: {
    calendar_list_events: { d: "List events between two ISO times.", a: read, s: { time_min: str, time_max: str, query: str }, req: ["time_min", "time_max"],
      run: (s, x) => (s.events ?? []).filter((e) => Date.parse(e.start) >= Date.parse(x.time_min) && Date.parse(e.start) < Date.parse(x.time_max) && has(`${e.title} ${e.description ?? ""} ${(e.attendees ?? []).join(" ")}`, x.query)).sort((a, b) => Date.parse(a.start) - Date.parse(b.start)) },
    calendar_free_slots: { d: "Free slots of at least duration_minutes between two ISO times, inside working hours (9-18 in the owner's time zone, weekdays).", a: read, s: { time_min: str, time_max: str, duration_minutes: int }, req: ["time_min", "time_max"],
      run: (s, x) => { const out = []; const dur = (x.duration_minutes ?? 30) * 60_000; for (let t = Math.ceil(Date.parse(x.time_min) / 1_800_000) * 1_800_000; t < Date.parse(x.time_max) && out.length < 20; t += 30 * 60_000) { const d = new Date(t); const h = d.getHours(); if (h < 9 || h >= 18 || d.getDay() === 0 || d.getDay() === 6) continue; const end = t + dur; if (overlaps(s, new Date(t).toISOString(), new Date(end).toISOString()).length) continue; out.push({ start: new Date(t).toISOString(), end: new Date(end).toISOString() }); } return out; } },
    calendar_create_event: { d: "Create an event and invite attendees (they get an email invite). Returns any events it overlaps.", a: outward, s: { title: str, start: str, end: str, attendees: strs, location: str, description: str }, req: ["title", "start", "end"],
      run: (s, x) => { const clash = overlaps(s, x.start, x.end); const e = { id: id("evt"), ...x, created: now() }; (s.events ??= []).push(e); log(s, "event_create", { title: x.title, start: x.start, attendees: x.attendees }); return { event_id: e.id, status: "created, invites sent", overlaps: clash }; } },
    calendar_update_event: { d: "Move or change an event (attendees get the update).", a: outward, s: { event_id: str, title: str, start: str, end: str, attendees: strs, location: str, description: str }, req: ["event_id"],
      run: (s, x) => { const e = must((s.events ?? []).find((e) => e.id === x.event_id), "event"); const before = { start: e.start, end: e.end }; Object.assign(e, Object.fromEntries(Object.entries(x).filter(([k, v]) => k !== "event_id" && v !== undefined))); e.updated = now(); log(s, "event_update", { title: e.title, before, start: e.start }); return { ok: true, overlaps: overlaps(s, e.start, e.end, e.id) }; } },
    calendar_delete_event: { d: "Cancel an event (attendees are told).", a: { readOnlyHint: false, destructiveHint: true }, s: { event_id: str }, req: ["event_id"],
      run: (s, x) => { const i = (s.events ?? []).findIndex((e) => e.id === x.event_id); if (i < 0) throw new Error("no such event"); const [e] = s.events.splice(i, 1); (s.cancelled ??= []).push({ ...e, cancelled: now() }); log(s, "event_delete", { title: e.title }); return { ok: true }; } },
  },
  slack: {
    slack_list_channels: { d: "Channels in the workspace with their topic and unread count.", a: read, s: {}, run: (s) => Object.entries(s.slack?.channels ?? {}).map(([name, c]) => ({ channel: name, topic: c.topic, members: c.members?.length, unread: (c.messages ?? []).filter((m) => !m.read).length })) },
    slack_history: { d: "Recent messages in a channel or DM (channel name like general, or dm:<person>), oldest first.", a: read, s: { channel: str, limit: int }, req: ["channel"],
      run: (s, x) => { const c = must(s.slack?.channels?.[x.channel.replace(/^#/, "")], "channel"); for (const m of c.messages) m.read = true; return c.messages.slice(-(x.limit ?? 30)).map(({ ts, user, text, thread_ts }) => ({ ts, user, text, thread_ts })); } },
    slack_search: { d: "Search messages across channels and DMs.", a: read, s: { query: str }, req: ["query"],
      run: (s, x) => Object.entries(s.slack?.channels ?? {}).flatMap(([name, c]) => c.messages.filter((m) => has(`${m.user} ${m.text}`, x.query)).map((m) => ({ channel: name, ...m }))).slice(-25) },
    slack_post: { d: "Post a message to a channel or DM (dm:<person>); thread_ts replies in a thread.", a: outward, s: { channel: str, text: str, thread_ts: str }, req: ["channel", "text"],
      run: (s, x) => { const name = x.channel.replace(/^#/, ""); const c = (s.slack.channels[name] ??= { topic: "", members: [], messages: [] }); const m = { ts: String(Date.now() / 1000), user: s.profile?.slack ?? s.profile?.name, text: x.text, thread_ts: x.thread_ts, by_assistant: true }; c.messages.push(m); log(s, "slack_post", { channel: name, text: x.text.slice(0, 200) }); return { ok: true, ts: m.ts }; } },
    slack_leave_channel: { d: "Leave a channel: you stop being a member and stop getting its messages.", a: write, s: { channel: str }, req: ["channel"],
      run: (s, x) => { const name = x.channel.replace(/^#/, ""); const c = must(s.slack?.channels?.[name], "channel"); const me = s.profile?.slack ?? s.profile?.name; c.members = (c.members ?? []).filter((m) => m !== me); c.left = true; log(s, "slack_leave", { channel: name }); return { ok: true }; } },
  },
  github: {
    github_list_repos: { d: "Repositories the account can access.", a: read, s: {}, run: (s) => (s.github?.repos ?? []).map(({ name, description, default_branch, issues, pulls }) => ({ name, description, default_branch, open_issues: issues.filter((i) => i.state === "open").length, open_prs: pulls.filter((p) => p.state === "open").length })) },
    github_list_issues: { d: "Issues in a repo (owner/name); state open|closed|all; label filter.", a: read, s: { repo: str, state: str, label: str }, req: ["repo"],
      run: (s, x) => must(repo(s, x.repo), "repo").issues.filter((i) => (x.state ?? "open") === "all" || i.state === (x.state ?? "open")).filter((i) => !x.label || (i.labels ?? []).includes(x.label)).map(({ number, title, state, labels, author, assignee, created }) => ({ number, title, state, labels, author, assignee, created })) },
    github_get_issue: { d: "One issue with its body and comments.", a: read, s: { repo: str, number: int }, req: ["repo", "number"], run: (s, x) => must(must(repo(s, x.repo), "repo").issues.find((i) => i.number === x.number), "issue") },
    github_list_pulls: { d: "Pull requests in a repo; state open|closed|all.", a: read, s: { repo: str, state: str }, req: ["repo"],
      run: (s, x) => must(repo(s, x.repo), "repo").pulls.filter((p) => (x.state ?? "open") === "all" || p.state === (x.state ?? "open")).map(({ number, title, state, author, checks, reviewers, created }) => ({ number, title, state, author, checks, reviewers, created })) },
    github_get_pull: { d: "One pull request with its description, changed files, CI checks and comments.", a: read, s: { repo: str, number: int }, req: ["repo", "number"], run: (s, x) => must(must(repo(s, x.repo), "repo").pulls.find((p) => p.number === x.number), "pull request") },
    github_comment: { d: "Comment on an issue or pull request.", a: outward, s: { repo: str, number: int, body: str }, req: ["repo", "number", "body"],
      run: (s, x) => { const r = must(repo(s, x.repo), "repo"); const item = must([...r.issues, ...r.pulls].find((i) => i.number === x.number), "issue or pull request"); (item.comments ??= []).push({ author: s.profile?.github, body: x.body, at: now(), by_assistant: true }); log(s, "gh_comment", { repo: r.name, number: x.number }); return { ok: true }; } },
    github_create_issue: { d: "Open a new issue.", a: outward, s: { repo: str, title: str, body: str, labels: strs, assignee: str }, req: ["repo", "title"],
      run: (s, x) => { const r = must(repo(s, x.repo), "repo"); const number = Math.max(0, ...r.issues.map((i) => i.number), ...r.pulls.map((p) => p.number)) + 1; r.issues.push({ number, title: x.title, body: x.body ?? "", labels: x.labels ?? [], assignee: x.assignee, state: "open", author: s.profile?.github, created: now(), comments: [], by_assistant: true }); log(s, "gh_issue", { repo: r.name, number, title: x.title }); return { number, url: `https://github.com/${r.name}/issues/${number}` }; } },
    github_update_issue: { d: "Close or reopen an issue, change labels or assignee.", a: write, s: { repo: str, number: int, state: str, labels: strs, assignee: str }, req: ["repo", "number"],
      run: (s, x) => { const r = must(repo(s, x.repo), "repo"); const i = must(r.issues.find((i) => i.number === x.number), "issue"); for (const k of ["state", "labels", "assignee"]) if (x[k] !== undefined) i[k] = x[k]; log(s, "gh_update", { repo: r.name, number: x.number, state: i.state }); return { ok: true }; } },
    github_request_review: { d: "Ask people to review a pull request.", a: outward, s: { repo: str, number: int, reviewers: strs }, req: ["repo", "number", "reviewers"],
      run: (s, x) => { const p = must(must(repo(s, x.repo), "repo").pulls.find((p) => p.number === x.number), "pull request"); p.reviewers = [...new Set([...(p.reviewers ?? []), ...x.reviewers])]; log(s, "gh_review_request", { number: x.number, reviewers: x.reviewers }); return { ok: true, reviewers: p.reviewers }; } },
  },
  notes: {
    notes_search: { d: "Search notes and docs by words; newest first.", a: read, s: { query: str }, run: (s, x) => (s.notes ?? []).filter((n) => has(`${n.title} ${n.body} ${n.folder}`, x.query)).sort((a, b) => Date.parse(b.updated) - Date.parse(a.updated)).map(({ id, title, folder, updated, body }) => ({ id, title, folder, updated, snippet: String(body).slice(0, 160) })) },
    notes_read: { d: "Read one note in full.", a: read, s: { note_id: str }, req: ["note_id"], run: (s, x) => must((s.notes ?? []).find((n) => n.id === x.note_id), "note") },
    notes_create: { d: "Create a note or doc in a folder.", a: write, s: { title: str, body: str, folder: str }, req: ["title", "body"],
      run: (s, x) => { const n = { id: id("note"), folder: "Notes", ...x, updated: now(), by_assistant: true }; (s.notes ??= []).push(n); log(s, "note_create", { title: x.title }); return { note_id: n.id }; } },
    notes_update: { d: "Replace a note's body (send the whole new text) or title.", a: write, s: { note_id: str, title: str, body: str }, req: ["note_id"],
      run: (s, x) => { const n = must((s.notes ?? []).find((n) => n.id === x.note_id), "note"); if (x.title) n.title = x.title; if (x.body !== undefined) n.body = x.body; n.updated = now(); log(s, "note_update", { title: n.title }); return { ok: true }; } },
  },
  shop: {
    shop_list_orders: { d: "Store orders, newest first; filter by status (paid, fulfilled, shipped, delivered, refunded, cancelled) or customer email.", a: read, s: { status: str, customer: str, limit: int },
      run: (s, x) => (s.shop?.orders ?? []).filter((o) => (!x.status || o.status === x.status) && has(o.email, x.customer)).sort((a, b) => Date.parse(b.created) - Date.parse(a.created)).slice(0, x.limit ?? 30).map(({ id, number, email, customer, total, status, created, items }) => ({ id, number, customer, email, total, status, created, items: items.map((i) => `${i.qty}x ${i.title}`) })) },
    shop_get_order: { d: "One order with items, shipping and notes.", a: read, s: { order: str }, req: ["order"], run: (s, x) => must(order(s, x.order), "order") },
    shop_refund_order: { d: "Refund an order in full or in part (amount in the store currency). Money goes back to the customer.", a: { readOnlyHint: false, destructiveHint: true, openWorldHint: true }, s: { order: str, amount: { type: "number" }, reason: str }, req: ["order"],
      run: (s, x) => { const o = must(order(s, x.order), "order"); const amount = x.amount ?? o.total; (o.refunds ??= []).push({ amount, reason: x.reason, at: now() }); if (amount >= o.total) o.status = "refunded"; log(s, "refund", { order: o.number, amount }); return { ok: true, refunded: amount, status: o.status }; } },
    shop_update_order: { d: "Change an order's status or add an internal note.", a: write, s: { order: str, status: str, note: str }, req: ["order"],
      run: (s, x) => { const o = must(order(s, x.order), "order"); if (x.status) o.status = x.status; if (x.note) (o.notes ??= []).push({ text: x.note, at: now() }); log(s, "order_update", { order: o.number, status: o.status }); return { ok: true }; } },
    shop_products: { d: "Products with price and stock.", a: read, s: { query: str }, run: (s, x) => (s.shop?.products ?? []).filter((p) => has(p.title, x.query)) },
    shop_update_product: { d: "Change a product's price or stock.", a: write, s: { sku: str, price: { type: "number" }, stock: int }, req: ["sku"],
      run: (s, x) => { const p = must((s.shop?.products ?? []).find((p) => p.sku === x.sku), "product"); if (x.price !== undefined) p.price = x.price; if (x.stock !== undefined) p.stock = x.stock; log(s, "product_update", { sku: p.sku, price: p.price, stock: p.stock }); return { ok: true }; } },
  },
  crm: {
    crm_search: { d: "Search contacts and deals by name, company, email or stage.", a: read, s: { query: str },
      run: (s, x) => ({ contacts: (s.crm?.contacts ?? []).filter((c) => has(JSON.stringify(c), x.query)), deals: (s.crm?.deals ?? []).filter((d) => has(JSON.stringify(d), x.query)) }) },
    crm_list_deals: { d: "Deals in the pipeline, filter by stage.", a: read, s: { stage: str }, run: (s, x) => (s.crm?.deals ?? []).filter((d) => !x.stage || lc(d.stage) === lc(x.stage)) },
    crm_update_deal: { d: "Move a deal to another stage, change its amount or next step.", a: write, s: { deal_id: str, stage: str, amount: { type: "number" }, next_step: str }, req: ["deal_id"],
      run: (s, x) => { const d = must((s.crm?.deals ?? []).find((d) => d.id === x.deal_id), "deal"); for (const k of ["stage", "amount", "next_step"]) if (x[k] !== undefined) d[k] = x[k]; d.updated = now(); log(s, "deal_update", { deal: d.name, stage: d.stage }); return { ok: true }; } },
    crm_add_note: { d: "Log a note on a contact or deal (id).", a: write, s: { id: str, text: str }, req: ["id", "text"],
      run: (s, x) => { const t = must([...(s.crm?.contacts ?? []), ...(s.crm?.deals ?? [])].find((c) => c.id === x.id), "contact or deal"); (t.notes ??= []).push({ text: x.text, at: now(), by_assistant: true }); log(s, "crm_note", { id: x.id }); return { ok: true }; } },
    crm_create_contact: { d: "Add a contact.", a: write, s: { name: str, email: str, company: str, phone: str, note: str }, req: ["name"],
      run: (s, x) => { const c = { id: id("ct"), ...x, created: now(), by_assistant: true }; ((s.crm ??= {}).contacts ??= []).push(c); log(s, "crm_contact", { name: x.name }); return { contact_id: c.id }; } },
  },
};
const repo = (s, name) => (s.github?.repos ?? []).find((r) => r.name === name || r.name.split("/")[1] === name);
const order = (s, key) => (s.shop?.orders ?? []).find((o) => o.id === key || String(o.number) === String(key).replace(/^#/, ""));

const tools = APPS[app];
if (!tools) { process.stderr.write(`unknown app ${app}\n`); process.exit(2); }

const reply = (msg) => process.stdout.write(`${JSON.stringify(msg)}\n`);
createInterface({ input: process.stdin }).on("line", (line) => {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  if (msg.id === undefined) return;
  const { method, params } = msg;
  if (method === "initialize") return reply({ jsonrpc: "2.0", id: msg.id, result: { protocolVersion: params?.protocolVersion ?? "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: app, version: "1.0.0" } } });
  if (method === "ping") return reply({ jsonrpc: "2.0", id: msg.id, result: {} });
  if (method === "tools/list") return reply({ jsonrpc: "2.0", id: msg.id, result: { tools: Object.entries(tools).map(([name, t]) => ({ name, description: t.d, annotations: t.a, inputSchema: { type: "object", properties: t.s, ...(t.req ? { required: t.req } : {}) } })) } });
  if (method === "tools/call") {
    const tool = tools[params?.name];
    if (!tool) return reply({ jsonrpc: "2.0", id: msg.id, error: { code: -32602, message: `unknown tool ${params?.name}` } });
    const state = load();
    (state.calls ??= []).push({ at: now(), app, tool: params.name });
    try {
      const fault = state.faults?.[params.name];
      if (fault?.times > 0) { fault.times -= 1; throw new Error(fault.error); }
      const out = tool.run(state, params.arguments ?? {});
      save(state);
      return reply({ jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: JSON.stringify(out, null, 1) }] } });
    } catch (error) {
      (state.errors ??= []).push({ at: now(), tool: params.name, error: String(error.message ?? error) });
      save(state);
      return reply({ jsonrpc: "2.0", id: msg.id, result: { isError: true, content: [{ type: "text", text: String(error.message ?? error) }] } });
    }
  }
  reply({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: `method not found: ${method}` } });
});
