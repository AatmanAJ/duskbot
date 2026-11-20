import { json, page, seeded } from "./site.ts";
import { answerHas, verdict, type BenchTask } from "./task.ts";

const FIRST = ["Aarav", "Bea", "Carlos", "Dana", "Elif", "Farah", "Gus", "Hana", "Ivo", "Jin", "Kofi", "Lara", "Mo", "Nadia", "Omar", "Pia", "Quinn", "Rosa", "Sven", "Tara", "Uma", "Vik", "Wren", "Xia", "Yusuf", "Zoe"];
const LAST = ["Abbott", "Banerjee", "Costa", "Dubois", "Eze", "Fischer", "Garcia", "Haddad", "Ito", "Jensen", "Kim", "Lopez", "Mensah", "Novak", "Okafor", "Park", "Quispe", "Rossi", "Silva", "Tanaka", "Ueda", "Vargas", "Weber", "Xu", "Yilmaz", "Zhang"];

function contacts(): string[] {
  const random = seeded(7);
  const names = new Set<string>();
  while (names.size < 399) names.add(`${FIRST[Math.floor(random() * FIRST.length)]} ${LAST[Math.floor(random() * LAST.length)]}`);
  const list = [...names].filter((name) => name !== "Priya Raman");
  list.splice(287, 0, "Priya Raman");
  return list;
}

const virtualChat: BenchTask = {
  id: "virtual-chat",
  group: "lists",
  title: "Virtualized chat list, the contact far down and no search",
  start: "chats",
  request: ({ base }) => `Open my chat with Priya Raman at ${base}chats and tell me what her last message says.`,
  check: (_run, answer) => answerHas(answer, "lease-final-v3.pdf"),
  routes: {
    chats: () => page("Chats", `<div class="app"><div class="side"><div class="head">Chats</div><div class="list" role="grid" aria-label="Chat list"><div class="spacer"></div></div></div>
<div class="pane"><div class="placeholder">Select a chat to start messaging</div></div></div>`, {
      style: `.app{display:grid;grid-template-columns:380px 1fr;height:100vh}.side{border-right:1px solid #ddd;display:flex;flex-direction:column}.head{padding:16px;font-weight:700;font-size:20px}
.list{flex:1;overflow-y:auto;position:relative}.spacer{position:relative}.row{position:absolute;left:0;right:0;height:64px;display:flex;align-items:center;gap:12px;padding:0 14px;cursor:pointer;border-bottom:1px solid #f3f3f3}.row:hover{background:#f5f6f6}
.av{width:44px;height:44px;border-radius:50%;background:#dfe5e7}.pane{background:#efeae2;padding:20px}.msg{background:#fff;border-radius:8px;padding:8px 10px;margin:8px 0;width:fit-content;max-width:70%}.mine{background:#d9fdd3;margin-left:auto}`,
      script: `const names = ${JSON.stringify(contacts())};
const ROW = 64, list = document.querySelector(".list"), spacer = document.querySelector(".spacer");
spacer.style.height = names.length * ROW + "px";
const times = ["09:12", "Yesterday", "Monday", "11/02/2026"];
function draw() {
  const first = Math.max(0, Math.floor(list.scrollTop / ROW) - 3), last = Math.min(names.length, Math.ceil((list.scrollTop + list.clientHeight) / ROW) + 3);
  spacer.innerHTML = "";
  for (let i = first; i < last; i++) {
    const row = document.createElement("div"); row.className = "row"; row.style.top = i * ROW + "px"; row.setAttribute("role", "row");
    row.innerHTML = '<div class="av"></div><div role="gridcell"><div><b>' + names[i] + '</b></div><div style="color:#667">' + times[i % 4] + "</div></div>";
    row.addEventListener("click", () => openChat(names[i]));
    spacer.appendChild(row);
  }
}
function openChat(name) {
  const lines = name === "Priya Raman"
    ? [["them", "Hey! Did the landlord reply?"], ["mine", "Not yet, chasing today"], ["them", "Got it. The signed lease is in the shared folder as lease-final-v3.pdf"]]
    : [["them", "Hi " + name.split(" ")[0] + " here"], ["mine", "hello!"]];
  document.querySelector(".pane").innerHTML = '<h3>' + name + "</h3>" + lines.map(([who, text]) => '<div class="msg ' + (who === "mine" ? "mine" : "") + '">' + text + "</div>").join("");
}
list.addEventListener("scroll", draw); draw();`,
    }),
  },
  async solve(call, { base }) {
    await call("agent_browser_open", { url: `${base}chats` });
    await call("agent_browser_eval", { expression: "document.querySelector('.list').scrollTop = 287 * 64 - 100, true" });
    await call("agent_browser_wait", { text: "Priya Raman" });
    await call("agent_browser_click", { selector: "text=Priya Raman" });
    return (await call("agent_browser_read", { selector: ".pane" })).includes("lease-final-v3.pdf") ? "lease-final-v3.pdf" : "";
  },
};

const POST_TEXT = ["Morning run done 🏃", "Hot take: tabs > spaces", "New blog post on caching", "Anyone at the meetup tonight?", "Shipped a tiny CLI", "Coffee recommendations?", "Finally fixed that flaky test", "Reading list for the weekend"];

const infiniteFeed: BenchTask = {
  id: "infinite-feed",
  group: "lists",
  title: "Infinite feed that loads more on scroll, like buttons all named Like",
  start: "home",
  request: ({ base }) => `On ${base}home, find the post where @lena_k talks about her first ceramics class and like it. Only like that one post.`,
  check(run) {
    const likes = run.events.filter((event) => event.type === "like");
    return verdict(likes.length === 1 && likes[0]!.post === 41, likes.length ? `liked ${likes.map((event) => event.post).join(",")}` : "liked nothing");
  },
  routes: {
    home: () => page("Home / Feed", `<main class="feed" aria-label="Timeline"><h1>Home</h1><div id="posts"></div><div id="sentinel" class="skeleton" aria-busy="true">Loading…</div></main>`, {
      style: `.feed{max-width:600px;margin:0 auto;border-left:1px solid #eee;border-right:1px solid #eee}h1{padding:12px 16px;margin:0;position:sticky;top:0;background:#fffe}.post{padding:14px 16px;border-top:1px solid #eee}.meta{color:#536471}
.actions{display:flex;gap:40px;margin-top:8px;color:#536471}.actions div{cursor:pointer}.liked{color:#f91880}.skeleton{padding:30px;color:#999}`,
      script: `let loaded = 0, loading = false;
const texts = ${JSON.stringify(POST_TEXT)};
const handles = ["dev_marco", "ana.codes", "tiny_tom", "lena_kovacs", "jpark", "ravi_p", "lena_k_art", "sora"];
function post(i) {
  const handle = i === 41 ? "lena_k" : handles[i % handles.length];
  const text = i === 41 ? "Went to my first ceramics class last night and made a very lopsided bowl. Loved it." : i === 17 ? "Ceramics studio tour next week, who is in?" : texts[i % texts.length];
  const el = document.createElement("article"); el.className = "post";
  el.innerHTML = '<div class="meta"><b style="color:#000">' + handle.replace(/[._]/g, " ") + '</b> @' + handle + ' · ' + (i + 1) + 'h</div><div class="text"></div><div class="actions"><div role="button" aria-label="Reply">💬 ' + (i % 7) + '</div><div role="button" aria-label="Repost">🔁 ' + (i % 5) + '</div><div role="button" aria-label="Like" data-testid="like">♡ ' + (i * 3 % 40) + "</div></div>";
  el.querySelector(".text").textContent = text;
  const like = el.querySelector('[data-testid=like]');
  like.addEventListener("click", () => { if (like.classList.contains("liked")) return; like.classList.add("liked"); like.setAttribute("aria-label", "Liked"); like.textContent = "♥ " + (i * 3 % 40 + 1); report("like", { post: i }); });
  return el;
}
function more() {
  if (loading || loaded >= 64) return; loading = true;
  setTimeout(() => { for (let k = 0; k < 8; k++) document.getElementById("posts").appendChild(post(loaded++)); loading = false; if (loaded >= 64) document.getElementById("sentinel").remove(); else check(); }, 700);
}
const io = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) more(); }, { rootMargin: "200px" });
function check() { const s = document.getElementById("sentinel"); if (s && s.getBoundingClientRect().top < innerHeight + 200) more(); }
io.observe(document.getElementById("sentinel"));`,
    }),
  },
  async solve(call, { base }) {
    await call("agent_browser_open", { url: `${base}home` });
    for (let i = 0; i < 12; i++) {
      const text = await call("agent_browser_read", {});
      if (text.includes("first ceramics class")) break;
      await call("agent_browser_scroll", { dy: 4000 });
      await call("agent_browser_wait", { ms: 900 });
    }
    await call("agent_browser_eval", { expression: "[...document.querySelectorAll('.post')].find((p) => p.textContent.includes('first ceramics class')).querySelector('[data-testid=like]').id = 'target', true" });
    await call("agent_browser_click", { selector: "#target" });
    return "liked";
  },
};

const lazyPricing: BenchTask = {
  id: "lazy-pricing",
  group: "lists",
  title: "Pricing that loads only when scrolled to, behind a billing toggle",
  start: "",
  request: ({ base }) => `On ${base}, what does the Team plan cost per month when billed monthly (not yearly)?`,
  check: (_run, answer) => answerHas(answer, "$37"),
  routes: {
    "": () => page("Flowboard — plans for every team", `<header class="nav">Flowboard <a href="#features">Features</a> <a href="#pricing">Pricing</a></header>
<section class="hero"><h1>Plan, track and ship together</h1><p>Flowboard brings your roadmaps, sprints and docs into one calm place.</p></section>
<section id="features">${Array.from({ length: 9 }, (_, i) => `<div class="feat"><h3>Feature ${i + 1}</h3><p>${"Fast boards, offline mode and integrations that just work. ".repeat(4)}</p></div>`).join("")}</section>
<section id="pricing" class="lazy" aria-busy="true"><div class="ph"></div></section><footer>© Flowboard</footer>`, {
      style: `.nav{position:sticky;top:0;background:#fff;padding:14px 24px;border-bottom:1px solid #eee;display:flex;gap:18px}.hero{padding:120px 24px;background:#f4f1ff}.feat{padding:40px 24px;min-height:260px;border-bottom:1px solid #f0f0f0}
#pricing{min-height:500px;padding:40px 24px}.ph{height:300px;background:linear-gradient(90deg,#eee,#f6f6f6,#eee)}.plans{display:flex;gap:20px}.plan{border:1px solid #ddd;border-radius:10px;padding:20px;width:220px}.price{font-size:32px;font-weight:700}
.toggle{display:inline-flex;border:1px solid #ccc;border-radius:20px;margin-bottom:20px}.toggle button{border:0;background:none;padding:6px 14px;border-radius:20px;cursor:pointer}.toggle button[aria-pressed=true]{background:#5b3df5;color:#fff}footer{padding:40px}`,
      script: `const io = new IntersectionObserver(async (entries) => {
  if (!entries[0].isIntersecting) return; io.disconnect();
  const plans = await (await fetch("api/pricing")).json();
  const el = document.getElementById("pricing"); el.removeAttribute("aria-busy");
  let yearly = true;
  const draw = () => {
    el.innerHTML = '<h2>Pricing</h2><div class="toggle" role="group" aria-label="Billing period"><button aria-pressed="' + yearly + '">Billed yearly</button><button aria-pressed="' + !yearly + '">Billed monthly</button></div><div class="plans">' +
      plans.map((p) => '<div class="plan"><h3>' + p.name + '</h3><div class="price">$' + (yearly ? p.yearly : p.monthly) + '</div><div>per user / month' + (yearly ? ", billed yearly" : "") + "</div></div>").join("") + "</div>";
    const [y, m] = el.querySelectorAll(".toggle button");
    y.onclick = () => { yearly = true; draw(); }; m.onclick = () => { yearly = false; draw(); };
  };
  draw();
}, { threshold: 0.1 });
io.observe(document.getElementById("pricing"));`,
    }),
    "api/pricing": () => json([{ name: "Starter", yearly: 0, monthly: 0 }, { name: "Team", yearly: 29, monthly: 37 }, { name: "Business", yearly: 59, monthly: 72 }], 600),
  },
  async solve(call, { base }) {
    await call("agent_browser_open", { url: base });
    await call("agent_browser_scroll", { selector: "#pricing", dy: 0 });
    await call("agent_browser_wait", { text: "Billed monthly" });
    await call("agent_browser_click", { selector: "text=Billed monthly" });
    return (await call("agent_browser_read", { selector: "#pricing" })).includes("$37") ? "$37" : "";
  },
};

function invoices(): Array<{ id: string; customer: string; amount: string; status: string }> {
  const random = seeded(11);
  const companies = ["Contoso", "Fabrikam", "Initech", "Globex", "Umbrella", "Hooli", "Vandelay", "Stark", "Wayne", "Acme", "Wonka", "Tyrell", "Cyberdyne", "Soylent", "Pied Piper"];
  const rows = Array.from({ length: 75 }, (_, i) => ({
    id: `INV-${3100 + i}`,
    customer: `${companies[i % companies.length]} ${["Ltd", "Inc", "GmbH", "LLC", "Co"][Math.floor(random() * 5)]}`,
    amount: `$${(Math.floor(random() * 2_000_000) / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`,
    status: ["Paid", "Open", "Overdue"][Math.floor(random() * 3)]!,
  }));
  rows[53] = { id: "INV-3153", customer: "Northwind Traders", amount: "$12,940.50", status: "Open" };
  return rows;
}

const pagedTable: BenchTask = {
  id: "paged-table",
  group: "lists",
  title: "Table with icon-only pagination and per-page loading",
  start: "billing",
  request: ({ base }) => `In the billing table at ${base}billing, find the invoice for Northwind Traders and tell me its amount.`,
  check: (_run, answer) => answerHas(answer, "12,940.50"),
  routes: {
    billing: () => page("Billing · Invoices", `<h1 style="padding:0 20px">Invoices</h1><table aria-label="Invoices"><thead><tr><th>Invoice</th><th>Customer</th><th>Amount</th><th>Status</th></tr></thead><tbody></tbody></table>
<nav class="pager" aria-label="Pagination"><button aria-label="Previous page">‹</button><span class="pages"></span><button aria-label="Next page">›</button><span class="count"></span></nav>`, {
      style: `table{border-collapse:collapse;margin:0 20px;width:800px}td,th{padding:10px;border-bottom:1px solid #eee;text-align:left}.pager{display:flex;gap:6px;padding:20px;align-items:center}.pager button{border:1px solid #ccc;background:#fff;border-radius:4px;min-width:30px;padding:4px}
.pager button[aria-current=page]{background:#222;color:#fff}.sk td{color:transparent;background:#f3f3f3}`,
      script: `let pageNo = 1; const per = 10, total = 75, pages = Math.ceil(total / per);
async function load(n) {
  pageNo = n; const body = document.querySelector("tbody");
  body.innerHTML = Array.from({ length: per }, () => '<tr class="sk"><td>.</td><td>.</td><td>.</td><td>.</td></tr>').join("");
  body.setAttribute("aria-busy", "true");
  const rows = await (await fetch("api/invoices?page=" + n)).json();
  body.removeAttribute("aria-busy");
  body.innerHTML = rows.map((r) => "<tr><td>" + r.id + "</td><td>" + r.customer + "</td><td>" + r.amount + "</td><td>" + r.status + "</td></tr>").join("");
  document.querySelector(".pages").innerHTML = Array.from({ length: pages }, (_, i) => '<button ' + (i + 1 === n ? 'aria-current="page"' : "") + ">" + (i + 1) + "</button>").join("");
  document.querySelectorAll(".pages button").forEach((b) => b.onclick = () => load(Number(b.textContent)));
  document.querySelector(".count").textContent = ((n - 1) * per + 1) + "–" + Math.min(total, n * per) + " of " + total;
}
document.querySelector('[aria-label="Previous page"]').onclick = () => pageNo > 1 && load(pageNo - 1);
document.querySelector('[aria-label="Next page"]').onclick = () => pageNo < pages && load(pageNo + 1);
load(1);`,
    }),
    "api/invoices": ({ query }) => { const n = Number(query.get("page") ?? "1"); return json(invoices().slice((n - 1) * 10, n * 10), 450); },
  },
  async solve(call, { base }) {
    await call("agent_browser_open", { url: `${base}billing` });
    await call("agent_browser_click", { selector: "role=button[name=\"6\"]" });
    await call("agent_browser_wait", { text: "Northwind Traders" });
    return (await call("agent_browser_read", { selector: "tbody" })).includes("12,940.50") ? "$12,940.50" : "";
  },
};

export const LIST_TASKS: BenchTask[] = [virtualChat, infiniteFeed, lazyPricing, pagedTable];
