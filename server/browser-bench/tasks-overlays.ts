import { page } from "./site.ts";
import { answerHas, lastEvent, verdict, type BenchTask } from "./task.ts";

const stickyCover: BenchTask = {
  id: "sticky-cover",
  group: "overlays",
  title: "Target at the page end under a fixed chat bar, with a sticky header",
  start: "notifications",
  request: ({ base }) => `On ${base}notifications, mark all notifications as read.`,
  check(run) {
    return verdict(lastEvent(run, "read-all") !== null, lastEvent(run, "read-all") ? "marked" : "not marked");
  },
  routes: {
    notifications: () => page("Notifications", `<header class="top"><b>Acme</b> Notifications</header><main>${Array.from({ length: 24 }, (_, i) => `<div class="n"><b>${["Priya", "Sam", "Lena", "Ravi"][i % 4]}</b> ${["commented on your doc", "mentioned you", "assigned you a task", "shared a file"][i % 4]} <span class="t">${i + 1}h</span></div>`).join("")}
<div class="end"><button id="all">Mark all as read</button></div></main>
<div class="chat" role="complementary" aria-label="Support chat"><span>👋 Questions? Chat with our team, we usually reply in a few minutes.</span><button aria-label="Close chat banner">✕</button></div>`, {
      style: `.top{position:sticky;top:0;height:110px;background:#111;color:#fff;padding:20px;z-index:5}main{max-width:700px;margin:0 auto}.n{padding:16px;border-bottom:1px solid #eee}.t{color:#888}.end{padding:12px 16px 20px}
#all{padding:10px 18px}.chat{position:fixed;left:0;right:0;bottom:0;height:96px;background:#4f46e5;color:#fff;display:flex;align-items:center;justify-content:space-between;padding:0 30px;z-index:10}.chat button{background:none;border:0;color:#fff;font-size:18px}`,
      script: `document.getElementById("all").onclick = () => { report("read-all"); document.querySelectorAll(".n").forEach((n) => n.style.opacity = .5); document.getElementById("all").textContent = "All caught up"; };
document.querySelector('.chat button').onclick = () => document.querySelector(".chat").remove();`,
    }),
  },
  async solve(call, { base }) {
    await call("agent_browser_open", { url: `${base}notifications` });
    await call("agent_browser_click", { selector: "role=button[name=\"Close chat banner\"]" });
    await call("agent_browser_click", { selector: "#all" });
    return "marked";
  },
};

const cookieWall: BenchTask = {
  id: "cookie-wall",
  group: "overlays",
  title: "Consent wall with no reject button until you open its settings",
  start: "",
  request: ({ base }) => `What is the top headline on ${base} today?`,
  check(run, answer) {
    const choice = lastEvent(run, "consent");
    if (choice?.choice === "accept-all") return verdict(false, "accepted all cookies");
    return answerHas(answer, "Harbor bridge reopens");
  },
  routes: {
    "": () => page("The Daily Ledger", `<header class="mast">The Daily Ledger</header><main id="news" aria-busy="true"><p>Loading today's stories…</p></main>
<div class="wall" role="dialog" aria-modal="true" aria-labelledby="ct"><div class="panel"><h2 id="ct">We value your privacy</h2><p>We and our 214 partners use cookies to personalise ads and content and to measure audiences.</p>
<div id="first"><button id="accept" class="primary">Accept all</button><button id="manage">Manage choices</button></div>
<div id="second" hidden><label><input type="checkbox" checked> Personalised advertising</label><br><label><input type="checkbox" checked> Audience measurement</label><br><button id="reject">Reject all</button> <button id="savec">Save choices</button></div></div></div>`, {
      style: `.mast{font:700 34px Georgia,serif;text-align:center;padding:20px;border-bottom:3px double #000}main{max-width:720px;margin:20px auto;font-family:Georgia,serif}.wall{position:fixed;inset:0;background:#000a;display:flex;align-items:center;justify-content:center;z-index:99}
.panel{background:#fff;max-width:520px;padding:26px;border-radius:10px}.panel button{margin:6px 6px 0 0;padding:9px 14px}.primary{background:#0a5;color:#fff;border:0}body.locked{overflow:hidden}`,
      script: `document.body.classList.add("locked");
function decide(choice) { report("consent", { choice }); document.querySelector(".wall").remove(); document.body.classList.remove("locked");
  setTimeout(() => { const n = document.getElementById("news"); n.removeAttribute("aria-busy"); n.innerHTML = "<h1>Harbor bridge reopens after two-year rebuild</h1><p>Commuters crossed the harbor on foot at dawn as the rebuilt bridge opened.</p><h2>Council votes on night buses</h2><h2>Rain returns for the weekend</h2>"; }, 400); }
document.getElementById("accept").onclick = () => decide("accept-all");
document.getElementById("manage").onclick = () => { document.getElementById("first").hidden = true; document.getElementById("second").hidden = false; };
document.getElementById("reject").onclick = () => decide("reject-all");
document.getElementById("savec").onclick = () => decide([...document.querySelectorAll("#second input")].some((i) => i.checked) ? "custom" : "reject-all");`,
    }),
  },
  async solve(call, { base }) {
    await call("agent_browser_open", { url: base });
    await call("agent_browser_batch", { steps: [{ do: "click", selector: "#manage" }, { do: "click", selector: "#reject" }, { do: "wait", text: "Harbor bridge" }] });
    return await call("agent_browser_read", { selector: "#news h1" });
  },
};

const hoverMenu: BenchTask = {
  id: "hover-menu",
  group: "overlays",
  title: "Nested menu that opens only on hover, to an unguessable address",
  start: "app",
  request: ({ base }) => `On ${base}app, open the Invoices page from the top menu (Account, then Billing) and tell me the most recent invoice number.`,
  check: (_run, answer) => answerHas(answer, "INV-20931"),
  routes: {
    app: () => page("Dashboard", `<nav class="bar"><b>Flowboard</b><div class="item"><span>Projects</span></div><div class="item" id="acct"><span>Account ▾</span>
<div class="menu" id="m1"><a href="profile">Profile</a><div class="sub" id="billing"><span>Billing ▸</span><div class="menu flyout" id="m2"><a href="billing/inv-7f3a9c">Invoices</a><a href="billing/pm-22b">Payment methods</a></div></div><a href="logout">Sign out</a></div></div></nav><main><h1>Welcome back</h1></main>`, {
      style: `.bar{display:flex;gap:30px;padding:14px 24px;background:#222;color:#fff}.item{position:relative;cursor:default}.menu{display:none;position:absolute;top:100%;left:0;background:#fff;color:#222;min-width:180px;box-shadow:0 4px 14px #0003;padding:6px 0}
.menu a,.sub>span{display:block;padding:8px 14px;color:#222;text-decoration:none}.menu a:hover,.sub:hover>span{background:#eee}.menu.open{display:block}.sub{position:relative}.flyout{top:0;left:100%}main{padding:24px}`,
      script: `function hoverOpen(trigger, menu) { let t; trigger.addEventListener("mouseenter", () => { clearTimeout(t); menu.classList.add("open"); }); trigger.addEventListener("mouseleave", () => { t = setTimeout(() => menu.classList.remove("open"), 200); }); }
hoverOpen(document.getElementById("acct"), document.getElementById("m1")); hoverOpen(document.getElementById("billing"), document.getElementById("m2"));`,
    }),
    "billing/inv-7f3a9c": () => page("Invoices", `<h1>Invoices</h1><table><tr><th>Number</th><th>Date</th><th>Total</th></tr><tr><td>INV-20931</td><td>Nov 1, 2026</td><td>$480.00</td></tr><tr><td>INV-20417</td><td>Oct 1, 2026</td><td>$480.00</td></tr></table>`),
    profile: () => page("Profile", "<h1>Profile</h1>"),
    "billing/pm-22b": () => page("Payment methods", "<h1>Payment methods</h1><p>Visa ending 4242</p>"),
  },
  async solve(call, { base }) {
    await call("agent_browser_open", { url: `${base}app` });
    await call("agent_browser_batch", { steps: [{ do: "hover", selector: "text=Account ▾" }, { do: "hover", selector: "text=Billing ▸" }, { do: "click", selector: "text=Invoices" }] });
    await call("agent_browser_wait", { text: "INV-" });
    return await call("agent_browser_read", {});
  },
};

const wizard: BenchTask = {
  id: "wizard-modal",
  group: "overlays",
  title: "Animated three-step modal with radio cards, a stepper and terms",
  start: "billing",
  request: ({ base }) => `On ${base}billing, upgrade to the Pro plan for the team "Orbit Labs" with 5 seats. It's a test account, so confirm the upgrade.`,
  check(run) {
    const up = lastEvent(run, "upgrade");
    return verdict(up?.plan === "pro" && up.team === "Orbit Labs" && up.seats === 5 && up.agreed === true, up ? `upgraded ${JSON.stringify(up)}` : "not upgraded");
  },
  routes: {
    billing: () => page("Billing", `<main style="padding:30px"><h1>Billing</h1><p>You're on the Free plan.</p><button id="open">Upgrade plan</button></main>
<div class="back" hidden><div class="modal" role="dialog" aria-modal="true" aria-labelledby="mt"><h2 id="mt">Upgrade</h2><div class="steps"></div></div></div>`, {
      style: `.back{position:fixed;inset:0;background:#0006;display:flex;align-items:center;justify-content:center}.back[hidden]{display:none}.modal{background:#fff;border-radius:12px;padding:24px;width:460px;transition:transform .35s,opacity .35s}.modal.enter{transform:translateY(60px);opacity:0}
.cards{display:flex;gap:10px}.card{flex:1;border:2px solid #ddd;border-radius:10px;padding:12px;cursor:pointer}.card[aria-checked=true]{border-color:#2457f5;background:#f0f4ff}.step{animation:slide .3s}@keyframes slide{from{transform:translateX(40px);opacity:0}}
.nav{display:flex;justify-content:flex-end;gap:8px;margin-top:18px}.nav button{padding:8px 14px}.seats{display:flex;gap:6px;align-items:center}.seats input{width:60px;padding:6px}.agree{display:flex;gap:8px;align-items:center;cursor:pointer}.agree input{position:absolute;opacity:0;width:1px;height:1px}.box{width:18px;height:18px;border:2px solid #555;border-radius:4px}.agree input:checked+.box{background:#2457f5;border-color:#2457f5}`,
      script: `const state = { plan: null, team: "", seats: 1, agreed: false }; let step = 1;
const back = document.querySelector(".back"), modal = document.querySelector(".modal"), steps = document.querySelector(".steps");
document.getElementById("open").onclick = () => { back.hidden = false; modal.classList.add("enter"); requestAnimationFrame(() => requestAnimationFrame(() => modal.classList.remove("enter"))); draw(); };
function draw() {
  if (step === 1) steps.innerHTML = '<div class="step"><p>Choose a plan</p><div class="cards" role="radiogroup" aria-label="Plan">' + ["starter:Starter:$8", "pro:Pro:$19", "business:Business:$39"].map((p) => { const [id, name, price] = p.split(":"); return '<div class="card" role="radio" tabindex="0" data-id="' + id + '" aria-checked="' + (state.plan === id) + '"><b>' + name + "</b><div>" + price + " / seat</div></div>"; }).join("") + '</div><div class="nav"><button id="next" ' + (state.plan ? "" : "disabled") + ">Continue</button></div></div>";
  if (step === 2) steps.innerHTML = '<div class="step"><label>Team name <input id="team" value="' + state.team + '"></label><p>Seats</p><div class="seats"><button aria-label="Fewer seats" id="minus">−</button><input id="seats" type="number" min="1" max="50" aria-label="Seats" value="' + state.seats + '"><button aria-label="More seats" id="plus">+</button></div><div class="nav"><button id="prev">Back</button><button id="next">Continue</button></div><p id="err" role="alert" style="color:#c00"></p></div>';
  if (step === 3) steps.innerHTML = '<div class="step"><p>' + state.plan + " plan for <b>" + state.team + "</b>, " + state.seats + ' seats.</p><label class="agree"><input type="checkbox" id="agree"><span class="box"></span> I agree to the terms of service</label><div class="nav"><button id="prev">Back</button><button id="confirm" disabled>Confirm upgrade</button></div></div>';
  steps.querySelectorAll(".card").forEach((c) => c.onclick = () => { state.plan = c.dataset.id; draw(); });
  const next = document.getElementById("next"), prev = document.getElementById("prev");
  if (prev) prev.onclick = () => { step--; draw(); };
  if (step === 2) {
    const seats = document.getElementById("seats"), sync = () => { state.seats = Math.max(1, Math.min(50, Number(seats.value) || 1)); };
    seats.oninput = sync; document.getElementById("team").oninput = (e) => state.team = e.target.value;
    document.getElementById("minus").onclick = () => { state.seats = Math.max(1, state.seats - 1); seats.value = state.seats; };
    document.getElementById("plus").onclick = () => { state.seats = Math.min(50, state.seats + 1); seats.value = state.seats; };
    next.onclick = () => { sync(); if (!state.team.trim()) { document.getElementById("err").textContent = "Enter a team name."; return; } step = 3; draw(); };
  } else if (next) next.onclick = () => { step = 2; draw(); };
  if (step === 3) { const a = document.getElementById("agree"); a.onchange = () => { state.agreed = a.checked; document.getElementById("confirm").disabled = !a.checked; };
    document.getElementById("confirm").onclick = () => { report("upgrade", { ...state }); back.hidden = true; document.querySelector("main p").textContent = "You're on the Pro plan."; }; }
}`,
    }),
  },
  async solve(call, { base }) {
    await call("agent_browser_open", { url: `${base}billing` });
    await call("agent_browser_batch", { steps: [
      { do: "click", selector: "#open" }, { do: "click", selector: "role=radio[name*=\"Pro\"]" }, { do: "click", selector: "#next" },
      { do: "fill", selector: "#team", text: "Orbit Labs" }, { do: "fill", selector: "#seats", text: "5" }, { do: "click", selector: "#next" },
      { do: "check", selector: "#agree" }, { do: "click", selector: "#confirm" },
    ] });
    return "upgraded";
  },
};

export const OVERLAY_TASKS: BenchTask[] = [stickyCover, cookieWall, hoverMenu, wizard];
