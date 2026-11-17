import { json, page, redirect } from "./site.ts";
import { answerHas, lastEvent, verdict, type BenchTask } from "./task.ts";

const PASSWORD = "Bench-Pass-77";

const loginWall: BenchTask = {
  id: "login-wall",
  group: "flows",
  title: "Deep link that redirects to sign-in and back",
  start: "account/orders/4471",
  request: ({ base }) => `Check the status of order 4471 at ${base}account/orders/4471. This is a test store: if it asks you to sign in, use username demo and password ${PASSWORD}.`,
  check: (_run, answer) => answerHas(answer, "Out for delivery"),
  routes: {
    "account/orders/4471": ({ cookies }) => cookies.bench_session === "ok"
      ? page("Order 4471", `<main style="padding:30px"><h1>Order #4471</h1><p>Placed Nov 12, 2026</p><dl><dt>Status</dt><dd id="status">Out for delivery</dd><dt>Arriving</dt><dd>Today by 8pm</dd></dl></main>`)
      : redirect("../../login?next=account/orders/4471"),
    login: () => page("Sign in", `<form class="f" onsubmit="event.preventDefault(); go()"><h2>Sign in to Shopwise</h2><label>Username or email<input name="username" autocomplete="username"></label>
<label>Password<input name="password" type="password" autocomplete="current-password"></label><label class="r"><input type="checkbox" name="remember"> Keep me signed in</label><button>Sign in</button><p id="err" role="alert"></p></form>`, {
      style: ".f{max-width:340px;margin:60px auto;display:flex;flex-direction:column;gap:10px}label{display:flex;flex-direction:column;gap:4px}.r{flex-direction:row}input{padding:8px}button{padding:10px;background:#111;color:#fff;border:0}#err{color:#c00}",
      script: `async function go() {
  const body = JSON.stringify({ u: document.querySelector("[name=username]").value, p: document.querySelector("[name=password]").value });
  const res = await fetch("api/login", { method: "POST", body });
  if (!res.ok) { document.getElementById("err").textContent = "Incorrect username or password."; return; }
  setTimeout(() => location.assign(new URLSearchParams(location.search).get("next") || "account"), 300);
}`,
    }),
    "api/login": ({ body }) => {
      const { u, p } = JSON.parse(body || "{}") as { u?: string; p?: string };
      return u === "demo" && p === PASSWORD ? { status: 200, type: "application/json", body: "{}", headers: { "set-cookie": "bench_session=ok; Path=/; SameSite=Lax" }, delayMs: 500 } : { status: 401, body: "{}", delayMs: 500 };
    },
  },
  async solve(call, { base }) {
    await call("agent_browser_open", { url: `${base}account/orders/4471` });
    await call("agent_browser_batch", { steps: [
      { do: "fill", selector: "[name=username]", text: "demo" }, { do: "fill", selector: "[name=password]", text: PASSWORD, submit: true },
      { do: "wait", text: "Order #4471" },
    ] });
    return await call("agent_browser_read", { selector: "#status" });
  },
};

const slowSpa: BenchTask = {
  id: "slow-spa",
  group: "flows",
  title: "Client-routed dashboard with skeletons and slow data",
  start: "dash",
  request: ({ base }) => `In the dashboard at ${base}dash, open Reports, then the Monthly revenue report, and tell me the total revenue for October.`,
  check: (_run, answer) => answerHas(answer, "$48,210"),
  routes: {
    dash: () => page("Dashboard", `<div class="app"><nav><a href="#" data-to="home">Home</a><a href="#" data-to="reports">Reports</a><a href="#" data-to="team">Team</a></nav><main id="view"></main></div>`, {
      style: `.app{display:grid;grid-template-columns:200px 1fr;height:100vh}nav{background:#f4f4f6;display:flex;flex-direction:column;padding:16px;gap:8px}main{padding:24px}.sk{height:18px;background:#eee;margin:10px 0;border-radius:4px;width:60%}table{border-collapse:collapse}td,th{padding:8px 14px;border-bottom:1px solid #eee}.rep{display:block;padding:12px;border:1px solid #ddd;border-radius:8px;margin:8px 0;cursor:pointer;width:320px}`,
      script: `const view = document.getElementById("view");
const skeleton = (n) => '<div aria-busy="true">' + '<div class="sk"></div>'.repeat(n) + "</div>";
async function route(to) {
  history.pushState({}, "", "#" + to);
  if (to === "home") view.innerHTML = "<h1>Welcome</h1><p>Pick a section on the left.</p>";
  if (to === "team") view.innerHTML = "<h1>Team</h1><p>4 members</p>";
  if (to === "reports") { view.innerHTML = "<h1>Reports</h1>" + skeleton(4); const list = await (await fetch("api/reports")).json();
    if (!location.hash.startsWith("#reports")) return;
    view.innerHTML = "<h1>Reports</h1>" + list.map((r) => '<div class="rep" role="link" tabindex="0" data-id="' + r.id + '">' + r.name + '<div style="color:#777">' + r.desc + "</div></div>").join("");
    view.querySelectorAll(".rep").forEach((el) => el.onclick = () => route("report-" + el.dataset.id)); }
  if (to.startsWith("report-")) { view.innerHTML = "<h1>Loading report…</h1>" + skeleton(8); const r = await (await fetch("api/report?id=" + to.slice(7))).json();
    view.innerHTML = "<h1>" + r.name + "</h1><table><tr><th>Month</th><th>Revenue</th></tr>" + r.rows.map((row) => "<tr><td>" + row[0] + "</td><td>" + row[1] + "</td></tr>").join("") + "</table>"; }
}
document.querySelectorAll("nav a").forEach((a) => a.onclick = (e) => { e.preventDefault(); route(a.dataset.to); });
route("home");`,
    }),
    "api/reports": () => json([{ id: "weekly", name: "Weekly signups", desc: "New accounts per week" }, { id: "monthly", name: "Monthly revenue", desc: "Revenue by month" }, { id: "churn", name: "Churn", desc: "Cancelled accounts" }], 1_800),
    "api/report": ({ query }) => json(query.get("id") === "monthly"
      ? { name: "Monthly revenue", rows: [["August", "$39,880"], ["September", "$44,105"], ["October", "$48,210"], ["November (to date)", "$21,640"]] }
      : { name: query.get("id"), rows: [["Week 44", "312"]] }, 3_200),
  },
  async solve(call, { base }) {
    await call("agent_browser_open", { url: `${base}dash` });
    await call("agent_browser_batch", { steps: [
      { do: "click", selector: "text=Reports" }, { do: "wait", text: "Monthly revenue" }, { do: "click", selector: "text=Monthly revenue" }, { do: "wait", text: "October" },
    ] });
    return await call("agent_browser_read", { selector: "table" });
  },
};

const TODOS = ["Write brief", "Call caterer", "Book venue", "Order badges", "Send invites", "Print agenda"];

const rerender: BenchTask = {
  id: "rerender-todo",
  group: "flows",
  title: "List that rebuilds and re-sorts itself after every click",
  start: "todo",
  request: ({ base }) => `On ${base}todo, mark "Write brief", "Book venue" and "Send invites" as done. Leave the other tasks alone.`,
  check(run) {
    const state = lastEvent(run, "todos")?.done as string[] | undefined;
    const want = ["Book venue", "Send invites", "Write brief"];
    return verdict(JSON.stringify([...(state ?? [])].sort()) === JSON.stringify(want), `done: ${JSON.stringify(state ?? [])}`);
  },
  routes: {
    todo: () => page("Event plan", `<main style="max-width:480px;margin:30px auto"><h1>Event plan</h1><ul id="list" style="list-style:none;padding:0"></ul><p id="st" role="status"></p></main>`, {
      style: `li{display:flex;gap:10px;align-items:center;padding:10px;border-bottom:1px solid #eee}li.done span{text-decoration:line-through;color:#999}li.saving{opacity:.5}`,
      script: `const items = ${JSON.stringify(TODOS)}.map((t) => ({ t, done: false }));
function draw() {
  const sorted = [...items].sort((a, b) => a.done - b.done);
  document.getElementById("list").innerHTML = sorted.map((i) => '<li class="' + (i.done ? "done" : "") + '"><input type="checkbox" aria-label="' + i.t + '"' + (i.done ? " checked" : "") + "><span>" + i.t + "</span></li>").join("");
  document.querySelectorAll("#list input").forEach((box) => box.addEventListener("change", () => {
    const item = items.find((i) => i.t === box.getAttribute("aria-label")); item.done = box.checked;
    box.closest("li").classList.add("saving"); document.getElementById("st").textContent = "Saving…";
    setTimeout(() => { draw(); document.getElementById("st").textContent = "Saved"; report("todos", { done: items.filter((i) => i.done).map((i) => i.t) }); }, 250);
  }));
}
draw();`,
    }),
  },
  async solve(call, { base }) {
    await call("agent_browser_open", { url: `${base}todo` });
    for (const name of ["Write brief", "Book venue", "Send invites"]) {
      await call("agent_browser_check", { selector: `role=checkbox[name="${name}"]` });
      await call("agent_browser_wait", { ms: 450 });
    }
    return "done";
  },
};

export const FLOW_TASKS: BenchTask[] = [loginWall, slowSpa, rerender];
