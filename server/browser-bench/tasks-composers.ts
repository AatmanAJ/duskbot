import { page } from "./site.ts";
import { lastEvent, verdict, type BenchTask } from "./task.ts";
import { EDITOR_CSS, RICH_EDITOR_JS } from "./widgets.ts";

const xDm: BenchTask = {
  id: "x-dm",
  group: "composers",
  title: "X-style DM in a model-driven contenteditable",
  start: "messages",
  request: ({ base }) => `Open ${base}messages and send Maya Chen this direct message: See you at 5pm, I'll bring the slides`,
  check(run) {
    const sent = run.events.filter((event) => event.type === "dm");
    const right = sent.find((event) => event.to === "Maya Chen" && String(event.text).trim() === "See you at 5pm, I'll bring the slides");
    if (!right) return verdict(false, sent.length ? `sent ${JSON.stringify(sent.map((event) => [event.to, event.text]))}` : "nothing sent");
    return verdict(sent.length === 1, sent.length === 1 ? "sent once to Maya" : `sent ${sent.length} messages`);
  },
  routes: {
    messages: () => page("Messages / X", `
<div class="app"><nav class="rail"><div class="logo">X</div><div class="navi">Home</div><div class="navi">Explore</div><div class="navi">Notifications</div><div class="navi active">Messages</div></nav>
<section class="convs"><h2>Messages</h2><div id="convs"></div></section>
<section class="thread"><div id="empty" class="emptythread"><h3>Select a message</h3><p>Choose from your existing conversations.</p></div>
<div id="open" hidden><header id="who"></header><div id="msgs"></div>
<div class="bar"><div class="composer empty" contenteditable="true" role="textbox" aria-multiline="true" data-placeholder="Start a new message" spellcheck="true"></div>
<div class="send" data-testid="dmComposerSendButton" aria-label="Send" role="button" aria-disabled="true" tabindex="0"><svg viewBox="0 0 24 24" width="20" height="20"><path d="M2 21l21-9L2 3v7l15 2-15 2z"/></svg></div></div></div></section></div>`, {
      style: `${EDITOR_CSS}.app{display:grid;grid-template-columns:90px 340px 1fr;height:100vh}.rail{border-right:1px solid #eee;padding:10px}.navi{padding:10px 0;cursor:pointer}.logo{font-weight:800;font-size:22px}
.convs{border-right:1px solid #eee;overflow:auto}.convs h2{padding:0 16px}.conv{display:flex;gap:10px;padding:12px 16px;cursor:pointer}.conv:hover{background:#f7f9f9}.conv.sel{background:#eef3f4;border-right:2px solid #1d9bf0}
.av{width:40px;height:40px;border-radius:50%;background:#cfd9de}.thread{display:flex;flex-direction:column}#open{display:flex;flex-direction:column;height:100vh}#open[hidden]{display:none}#who{padding:14px;font-weight:700;border-bottom:1px solid #eee}#msgs{flex:1;overflow:auto;padding:14px}
.bubble{background:#1d9bf0;color:#fff;border-radius:16px;padding:8px 12px;margin:6px 0 6px auto;max-width:60%;width:fit-content}.them{background:#eff3f4;color:#000;margin-left:0}
.bar{display:flex;align-items:center;gap:8px;margin:10px;background:#eff3f4;border-radius:16px;padding:8px 12px}.composer{flex:1;min-height:22px;position:relative}.send{cursor:pointer;color:#1d9bf0}.send[aria-disabled=true]{opacity:.4;cursor:default}.emptythread{padding:40px}`,
      script: `${RICH_EDITOR_JS}
const people = ["Jordan Blake", "Maya Chen", "Maya Cheng", "Sam Ortiz", "Lena Kovac", "Ravi Patel"];
const history = { "Maya Chen": ["Are we still on for today?"], "Maya Cheng": ["loved the talk!"] };
let current = null;
const convs = document.getElementById("convs");
for (const name of people) {
  const row = document.createElement("div"); row.className = "conv"; row.dataset.testid = "conversation";
  row.innerHTML = '<div class="av"></div><div><b>' + name + '</b> <span style="color:#536471">@' + name.toLowerCase().replace(/ /g, "_") + '</span><div style="color:#536471">' + ((history[name] || ["Say hi"])[0]) + "</div></div>";
  row.addEventListener("click", () => openThread(name, row));
  convs.appendChild(row);
}
const box = document.querySelector(".composer"), send = document.querySelector(".send");
const editor = richEditor(box, { onChange: (text) => send.setAttribute("aria-disabled", text.trim() ? "false" : "true"), onEnter: () => doSend() });
function openThread(name, row) {
  current = name; document.querySelectorAll(".conv").forEach((r) => r.classList.toggle("sel", r === row));
  document.getElementById("empty").hidden = true; document.getElementById("open").hidden = false;
  document.getElementById("who").textContent = name;
  document.getElementById("msgs").innerHTML = (history[name] || []).map((m) => '<div class="bubble them">' + m + "</div>").join("");
  editor.clear();
}
function doSend() {
  const text = editor.text.trim();
  if (!text || !current) return;
  report("dm", { to: current, text });
  const b = document.createElement("div"); b.className = "bubble"; b.textContent = text; document.getElementById("msgs").appendChild(b);
  editor.clear();
}
send.addEventListener("click", () => { if (send.getAttribute("aria-disabled") === "false") doSend(); });`,
    }),
  },
  async solve(call, { base }) {
    await call("agent_browser_open", { url: `${base}messages` });
    await call("agent_browser_click", { selector: "text=Are we still on for today?" });
    await call("agent_browser_type", { selector: ".composer", text: "See you at 5pm, I'll bring the slides" });
    await call("agent_browser_click", { selector: "role=button[name=\"Send\"]" });
    return "sent";
  },
};

const gmail: BenchTask = {
  id: "gmail-compose",
  group: "composers",
  title: "Gmail-style compose: recipient chips and a rich body",
  start: "mail",
  request: ({ base }) => `In the mail app at ${base}mail, email sam@acme.test with the subject "Q3 numbers" and this body: Hi Sam, the Q3 numbers are attached. Thanks, Alex`,
  check(run) {
    const mail = lastEvent(run, "email");
    if (!mail) return verdict(false, "no email sent");
    const to = mail.to as string[];
    const ok = to.length === 1 && to[0] === "sam@acme.test" && mail.subject === "Q3 numbers" && String(mail.body).trim() === "Hi Sam, the Q3 numbers are attached. Thanks, Alex";
    return verdict(ok && run.events.filter((event) => event.type === "email").length === 1, ok ? "sent" : `sent ${JSON.stringify(mail)}`);
  },
  routes: {
    mail: () => page("Inbox - alex@acme.test - Mail", `
<div class="top"><b>Mail</b><input aria-label="Search mail" placeholder="Search mail"></div>
<div class="main"><aside><div class="compose" role="button" tabindex="0">✎ Compose</div><div>Inbox</div><div>Starred</div><div>Sent</div></aside>
<div class="list"><div class="mailrow"><b>Priya</b> Lunch friday? - sure, let me check</div><div class="mailrow"><b>Acme Billing</b> Your invoice - attached</div></div></div>
<div class="dialog" role="dialog" aria-label="New Message" hidden><div class="dh">New Message <span class="x" role="button" aria-label="Save &amp; close" tabindex="0">✕</span></div>
<div class="row to"><span>To</span><div class="chips"></div><input aria-label="To recipients" autocomplete="off"></div>
<div class="row"><input name="subjectbox" placeholder="Subject" aria-label="Subject"></div>
<div class="body empty" contenteditable="true" role="textbox" aria-label="Message Body" aria-multiline="true"></div>
<div class="foot"><div class="sendb" role="button" tabindex="0" aria-label="Send ‪(⌘Enter)‬" data-tooltip="Send">Send</div></div><div class="err" role="alert"></div></div>`, {
      style: `${EDITOR_CSS}.top{display:flex;gap:30px;padding:10px 20px;border-bottom:1px solid #eee}.top input{width:500px;padding:8px;border-radius:8px;border:0;background:#eef}.main{display:flex}aside{width:200px;padding:10px}aside>div{padding:8px}
.compose{background:#c2e7ff;border-radius:16px;padding:16px!important;width:130px;cursor:pointer}.list{flex:1}.mailrow{padding:10px;border-bottom:1px solid #f0f0f0}
.dialog{position:fixed;right:40px;bottom:0;width:520px;background:#fff;box-shadow:0 0 20px #0004;border-radius:8px 8px 0 0}.dialog[hidden]{display:none}.dh{background:#f2f6fc;padding:10px;display:flex;justify-content:space-between}
.row{display:flex;gap:6px;align-items:center;border-bottom:1px solid #eee;padding:6px 10px}.row input{border:0;flex:1;outline:none;padding:4px}.chip{background:#e8eaed;border-radius:12px;padding:2px 8px}
.body{min-height:220px;padding:10px;position:relative}.foot{padding:10px}.sendb{background:#0b57d0;color:#fff;border-radius:18px;padding:8px 20px;width:fit-content;cursor:pointer}.err{color:#b00;padding:0 10px 10px}`,
      script: `${RICH_EDITOR_JS}
const dialog = document.querySelector(".dialog"), toInput = document.querySelector('[aria-label="To recipients"]'), chips = document.querySelector(".chips");
const editor = richEditor(document.querySelector(".body"));
let recipients = [];
const valid = (s) => /^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/.test(s);
function chipIt() {
  for (const part of toInput.value.split(/[,;\\s]+/)) if (valid(part) && !recipients.includes(part)) recipients.push(part);
  toInput.value = "";
  chips.innerHTML = recipients.map((r) => '<span class="chip">' + r + "</span>").join("");
}
toInput.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === "," || e.key === "Tab") { if (toInput.value.trim()) { if (e.key !== "Tab") e.preventDefault(); chipIt(); } } });
toInput.addEventListener("blur", chipIt);
document.querySelector(".compose").addEventListener("click", () => { dialog.hidden = false; setTimeout(() => toInput.focus(), 50); });
document.querySelector(".x").addEventListener("click", () => { dialog.hidden = true; });
document.querySelector(".sendb").addEventListener("click", () => {
  chipIt();
  const err = document.querySelector(".err");
  if (!recipients.length) { err.textContent = "Please specify at least one recipient."; return; }
  report("email", { to: recipients, subject: document.querySelector('[name=subjectbox]').value, body: editor.text });
  dialog.hidden = true; recipients = []; chips.innerHTML = ""; editor.clear(); document.querySelector('[name=subjectbox]').value = "";
  const toast = document.createElement("div"); toast.role = "status"; toast.textContent = "Message sent"; toast.style = "position:fixed;left:20px;bottom:20px;background:#333;color:#fff;padding:12px"; document.body.appendChild(toast);
});`,
    }),
  },
  async solve(call, { base }) {
    await call("agent_browser_open", { url: `${base}mail` });
    await call("agent_browser_batch", { steps: [
      { do: "click", selector: "text=✎ Compose" },
      { do: "fill", selector: "[aria-label=\"To recipients\"]", text: "sam@acme.test" },
      { do: "press", key: "Enter" },
      { do: "fill", selector: "[name=subjectbox]", text: "Q3 numbers" },
      { do: "fill", selector: "[aria-label=\"Message Body\"]", text: "Hi Sam, the Q3 numbers are attached. Thanks, Alex" },
      { do: "click", selector: ".sendb" },
    ] });
    return "sent";
  },
};

const slack: BenchTask = {
  id: "slack-multiline",
  group: "composers",
  title: "Slack-style channel post on two lines, where Enter sends",
  start: "client",
  request: ({ base }) => `In the team chat at ${base}client, post this in the #design channel as one message on two lines:\nShipping the new nav today\nReview link is in the thread`,
  check(run) {
    const posts = run.events.filter((event) => event.type === "post");
    const right = posts.length === 1 && posts[0]!.channel === "design" && String(posts[0]!.text).trim() === "Shipping the new nav today\nReview link is in the thread";
    return verdict(right, posts.length ? `posted ${JSON.stringify(posts.map((event) => [event.channel, event.text]))}` : "nothing posted");
  },
  routes: {
    client: () => page("Slack | design | Acme", `
<div class="app"><aside><div class="ws">Acme</div><div class="sec">Channels</div><div class="chan" data-c="general"># general</div><div class="chan" data-c="design"># design</div><div class="chan" data-c="random"># random</div><div class="sec">Direct messages</div><div class="chan dm">Priya</div></aside>
<main><header id="title"># general</header><div id="log"></div>
<div class="composerwrap"><div class="ql-editor empty" contenteditable="true" role="textbox" aria-multiline="true" data-placeholder="Message #general" aria-label="Message to general"></div>
<div class="tools"><span>B</span><span>I</span><span>🔗</span><button class="sendbtn" aria-label="Send now" data-qa="texty_send_button">➤</button></div></div></main></div>`, {
      style: `${EDITOR_CSS}.app{display:grid;grid-template-columns:240px 1fr;height:100vh}aside{background:#3f0e40;color:#ddd;padding:12px}.ws{font-weight:700;color:#fff;margin-bottom:14px}.sec{margin-top:14px;font-size:12px;opacity:.7}.chan{padding:4px 8px;cursor:pointer;border-radius:4px}.chan.sel{background:#1164a3;color:#fff}
main{display:flex;flex-direction:column}#title{padding:12px;font-weight:700;border-bottom:1px solid #ddd}#log{flex:1;overflow:auto;padding:12px}.msg{padding:6px 0;white-space:pre-wrap}
.composerwrap{margin:12px;border:1px solid #bbb;border-radius:8px}.ql-editor{padding:10px;min-height:40px;position:relative}.tools{display:flex;gap:10px;padding:6px 10px;color:#666;align-items:center}.sendbtn{margin-left:auto;background:#007a5a;color:#fff;border:0;border-radius:4px;padding:4px 10px}`,
      script: `${RICH_EDITOR_JS}
const logs = { general: ["Priya: standup moved to 10:15"], design: ["Lena: new icons are in Figma"], random: ["Sam: 🌮"] };
let channel = "general";
const box = document.querySelector(".ql-editor");
const editor = richEditor(box, { onEnter: () => post() });
function show(c) {
  channel = c; document.getElementById("title").textContent = "# " + c;
  box.dataset.placeholder = "Message #" + c; box.setAttribute("aria-label", "Message to " + c);
  document.querySelectorAll(".chan").forEach((el) => el.classList.toggle("sel", el.dataset.c === c));
  document.getElementById("log").innerHTML = logs[c].map((m) => '<div class="msg"></div>').join("");
  document.querySelectorAll("#log .msg").forEach((el, i) => { el.textContent = logs[c][i]; });
  editor.clear();
}
function post() {
  const text = editor.text.replace(/\\s+$/, "");
  if (!text.trim()) return;
  report("post", { channel, text });
  logs[channel].push("Alex: " + text); show(channel);
}
document.querySelectorAll(".chan[data-c]").forEach((el) => el.addEventListener("click", () => show(el.dataset.c)));
document.querySelector(".sendbtn").addEventListener("click", post);
show("general");`,
    }),
  },
  async solve(call, { base }) {
    await call("agent_browser_open", { url: `${base}client` });
    await call("agent_browser_click", { selector: "text=# design" });
    await call("agent_browser_type", { selector: ".ql-editor", text: "Shipping the new nav today\nReview link is in the thread" });
    await call("agent_browser_press", { key: "Enter" });
    return "posted";
  },
};

export const COMPOSER_TASKS: BenchTask[] = [xDm, gmail, slack];
