import { json, page } from "./site.ts";
import { lastEvent, verdict, type BenchTask } from "./task.ts";

const CITIES = [
  { id: "lisbon-pt", label: "Lisbon, Portugal" }, { id: "lisbon-oh", label: "Lisbon, Ohio, US" }, { id: "lisburn-uk", label: "Lisburn, UK" },
  { id: "london-uk", label: "London, UK" }, { id: "lima-pe", label: "Lima, Peru" }, { id: "lyon-fr", label: "Lyon, France" }, { id: "porto-pt", label: "Porto, Portugal" },
];

const combobox: BenchTask = {
  id: "combobox",
  group: "widgets",
  title: "Async autocomplete that only accepts a picked option",
  start: "address",
  request: ({ base }) => `On ${base}address, set the street to 12 Rua Augusta and the city to Lisbon, Portugal, then save the address.`,
  check(run) {
    const saved = lastEvent(run, "address");
    return verdict(saved?.street === "12 Rua Augusta" && saved.city === "lisbon-pt", saved ? `saved ${JSON.stringify(saved)}` : "not saved");
  },
  routes: {
    address: () => page("Shipping address", `<form class="card" onsubmit="return false"><h2>Shipping address</h2>
<label>Street<input name="street" autocomplete="off"></label>
<label for="city">City</label><div class="cb"><input id="city" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="city-list" autocomplete="off" placeholder="Start typing a city"><ul id="city-list" role="listbox" hidden></ul></div>
<div class="hint" id="hint"></div><button type="button" id="save">Save address</button><p id="done" role="status"></p></form>`, {
      style: `.card{max-width:420px;margin:40px auto;display:flex;flex-direction:column;gap:8px}label{display:flex;flex-direction:column;gap:4px}input{padding:8px;border:1px solid #bbb;border-radius:6px}.cb{position:relative}
ul{position:absolute;top:100%;left:0;right:0;margin:2px 0;padding:4px;list-style:none;background:#fff;border:1px solid #ccc;border-radius:6px;box-shadow:0 4px 12px #0002;z-index:2}li{padding:8px;border-radius:4px;cursor:pointer}li:hover,li[aria-selected=true]{background:#eef}
.hint{color:#b00;min-height:18px}button{padding:10px;border-radius:6px;border:0;background:#222;color:#fff}`,
      script: `const input = document.getElementById("city"), list = document.getElementById("city-list");
let chosen = null, timer = null, seq = 0;
function close() { list.hidden = true; input.setAttribute("aria-expanded", "false"); }
input.addEventListener("input", () => {
  chosen = null; clearTimeout(timer);
  const q = input.value.trim(); if (!q) return close();
  timer = setTimeout(async () => {
    const mine = ++seq; const found = await (await fetch("api/cities?q=" + encodeURIComponent(q))).json();
    if (mine !== seq) return;
    list.innerHTML = found.map((c) => '<li role="option" id="opt-' + c.id + '" data-id="' + c.id + '">' + c.label + "</li>").join("") || '<li aria-disabled="true">No matches</li>';
    list.hidden = false; input.setAttribute("aria-expanded", "true");
    list.querySelectorAll("li[data-id]").forEach((li) => li.addEventListener("mousedown", (e) => { e.preventDefault(); chosen = li.dataset.id; input.value = li.textContent; close(); }));
  }, 300);
});
input.addEventListener("blur", () => setTimeout(() => { close(); if (!chosen) { input.value = ""; document.getElementById("hint").textContent = "Pick a city from the list."; } else document.getElementById("hint").textContent = ""; }, 150));
document.getElementById("save").addEventListener("click", () => {
  if (!chosen) { document.getElementById("hint").textContent = "Pick a city from the list."; return; }
  report("address", { street: document.querySelector("[name=street]").value, city: chosen });
  document.getElementById("done").textContent = "Address saved.";
});`,
    }),
    "api/cities": ({ query }) => { const q = (query.get("q") ?? "").toLowerCase(); return json(CITIES.filter((city) => city.label.toLowerCase().startsWith(q.slice(0, 3)) && city.label.toLowerCase().includes(q.split(",")[0]!.trim())), 400); },
  },
  async solve(call, { base }) {
    await call("agent_browser_open", { url: `${base}address` });
    await call("agent_browser_fill", { selector: "[name=street]", text: "12 Rua Augusta" });
    await call("agent_browser_type", { selector: "#city", text: "Lisbon" });
    await call("agent_browser_wait", { selector: "#opt-lisbon-pt" });
    await call("agent_browser_click", { selector: "#opt-lisbon-pt" });
    await call("agent_browser_click", { selector: "#save" });
    return "saved";
  },
};

const COUNTRIES = ["Argentina", "Australia", "Austria", "Belgium", "Brazil", "Bulgaria", "Canada", "Chile", "China", "Colombia", "Croatia", "Czechia", "Denmark", "Egypt", "Estonia", "Finland", "France", "Germany", "Ghana", "Greece", "Hungary", "Iceland", "India", "Indonesia", "Ireland", "Israel", "Italy", "Japan", "Kenya", "Latvia", "Lithuania", "Mexico", "Morocco", "Netherlands", "New Zealand", "Nigeria", "Norway", "Pakistan", "Peru", "Philippines", "Poland", "Portugal", "Romania", "Serbia", "Singapore", "Slovakia", "Slovenia", "South Africa", "South Korea", "Spain", "Sweden", "Switzerland", "Thailand", "Turkey", "Ukraine", "United Kingdom", "United States", "Uruguay", "Vietnam", "Zambia"];
const LANGUAGES = ["Arabic", "Bengali", "Chinese", "Dutch", "English", "French", "German", "Hindi", "Italian", "Japanese", "Korean", "Polish", "Portuguese", "Russian", "Spanish", "Swedish", "Turkish"];

const dropdown: BenchTask = {
  id: "custom-dropdown",
  group: "widgets",
  title: "Div dropdowns rendered in a portal with a scrolling list",
  start: "profile",
  request: ({ base }) => `On ${base}profile, set the country to Uruguay and the language to Spanish, then save.`,
  check(run) {
    const saved = lastEvent(run, "profile");
    return verdict(saved?.country === "Uruguay" && saved.language === "Spanish", saved ? `saved ${JSON.stringify(saved)}` : "not saved");
  },
  routes: {
    profile: () => page("Profile settings", `<div class="card"><h2>Region</h2>
<div class="field"><span id="country-label">Country</span><button class="dd" id="country" aria-haspopup="listbox" aria-expanded="false" aria-labelledby="country-label country">Select…</button></div>
<div class="field"><span id="lang-label">Language</span><button class="dd" id="language" aria-haspopup="listbox" aria-expanded="false" aria-labelledby="lang-label language">English</button></div>
<button id="save" class="primary">Save</button><p role="status" id="st"></p></div>`, {
      style: `.card{max-width:380px;margin:40px auto;display:flex;flex-direction:column;gap:14px}.field{display:flex;flex-direction:column;gap:4px}.dd{text-align:left;padding:9px;border:1px solid #bbb;border-radius:6px;background:#fff}
.menu{position:absolute;max-height:220px;overflow:auto;background:#fff;border:1px solid #ccc;border-radius:6px;box-shadow:0 6px 16px #0003;padding:4px;margin:0;list-style:none;z-index:9}.menu div{padding:7px 10px;border-radius:4px;cursor:default}.menu div[data-active]{background:#e6efff}.primary{background:#2457f5;color:#fff;border:0;border-radius:6px;padding:10px}`,
      script: `const values = { country: null, language: "English" };
const options = { country: ${JSON.stringify(COUNTRIES)}, language: ${JSON.stringify(LANGUAGES)} };
let open = null;
function closeMenu() { if (!open) return; open.menu.remove(); open.button.setAttribute("aria-expanded", "false"); open = null; }
function openMenu(button) {
  closeMenu();
  const key = button.id, r = button.getBoundingClientRect();
  const menu = document.createElement("div"); menu.className = "menu"; menu.setAttribute("role", "listbox"); menu.tabIndex = -1;
  menu.style.left = r.left + scrollX + "px"; menu.style.top = r.bottom + scrollY + 4 + "px"; menu.style.width = r.width + "px";
  menu.innerHTML = options[key].map((o) => '<div role="option" aria-selected="' + (values[key] === o) + '">' + o + "</div>").join("");
  menu.querySelectorAll("[role=option]").forEach((el) => {
    el.addEventListener("pointerenter", () => { menu.querySelectorAll("[data-active]").forEach((a) => a.removeAttribute("data-active")); el.dataset.active = ""; });
    el.addEventListener("click", () => choose(key, el.textContent));
  });
  document.body.appendChild(menu); button.setAttribute("aria-expanded", "true"); open = { button, menu, key, active: -1 };
  menu.focus();
}
function choose(key, value) { values[key] = value; document.getElementById(key).textContent = value; closeMenu(); }
document.querySelectorAll(".dd").forEach((b) => b.addEventListener("click", (e) => { e.stopPropagation(); open && open.button === b ? closeMenu() : openMenu(b); }));
document.addEventListener("click", (e) => { if (open && !open.menu.contains(e.target)) closeMenu(); });
document.addEventListener("keydown", (e) => {
  if (!open) return;
  const items = [...open.menu.querySelectorAll("[role=option]")];
  if (e.key === "Escape") return closeMenu();
  if (e.key === "Enter" && open.active >= 0) return choose(open.key, items[open.active].textContent);
  if (e.key === "ArrowDown") open.active = Math.min(items.length - 1, open.active + 1);
  else if (e.key === "ArrowUp") open.active = Math.max(0, open.active - 1);
  else if (e.key.length === 1) { const i = items.findIndex((el) => el.textContent.toLowerCase().startsWith(e.key.toLowerCase())); if (i >= 0) open.active = i; }
  else return;
  items.forEach((el, i) => i === open.active ? el.dataset.active = "" : el.removeAttribute("data-active"));
  items[open.active] && items[open.active].scrollIntoView({ block: "nearest" });
});
document.getElementById("save").addEventListener("click", () => { report("profile", { ...values }); document.getElementById("st").textContent = "Saved."; });`,
    }),
  },
  async solve(call, { base }) {
    await call("agent_browser_open", { url: `${base}profile` });
    await call("agent_browser_batch", { steps: [
      { do: "click", selector: "#country" }, { do: "click", selector: "role=option[name=\"Uruguay\"]" },
      { do: "click", selector: "#language" }, { do: "click", selector: "role=option[name=\"Spanish\"]" },
      { do: "click", selector: "#save" },
    ] });
    return "saved";
  },
};

const datePicker: BenchTask = {
  id: "date-picker",
  group: "widgets",
  title: "Read-only date range picker that pages month by month",
  start: "stays",
  request: ({ base }) => `On ${base}stays, search for a stay checking in on March 14, 2027 and checking out on March 18, 2027.`,
  check(run) {
    const search = lastEvent(run, "search");
    return verdict(search?.checkIn === "2027-03-14" && search.checkOut === "2027-03-18", search ? `searched ${JSON.stringify(search)}` : "no search");
  },
  routes: {
    stays: () => page("Find a stay", `<div class="bar"><label>Where<input value="Lisbon" name="where"></label>
<label>Check in<input id="in" readonly placeholder="Add date"></label><label>Check out<input id="out" readonly placeholder="Add date"></label><button id="go">Search</button></div>
<div id="cal" role="dialog" aria-label="Choose dates" hidden><div class="ch"><button class="nav" aria-label="Previous month">‹</button><h3 id="month" aria-live="polite"></h3><button class="nav" aria-label="Next month">›</button></div><div class="grid" id="days"></div></div><p role="status" id="st"></p>`, {
      style: `.bar{display:flex;gap:10px;padding:30px;align-items:flex-end}label{display:flex;flex-direction:column;font-size:12px}input{padding:8px;border:1px solid #bbb;border-radius:6px;cursor:pointer}#go{padding:9px 16px;background:#e31c5f;color:#fff;border:0;border-radius:6px}
#cal{position:absolute;left:150px;top:100px;background:#fff;box-shadow:0 6px 20px #0003;border-radius:12px;padding:16px;width:330px}#cal[hidden]{display:none}.ch{display:flex;justify-content:space-between;align-items:center}.ch h3{margin:0}
.grid{display:grid;grid-template-columns:repeat(7,1fr);gap:2px;margin-top:10px}.grid button{border:0;background:none;padding:8px 0;border-radius:50%;cursor:pointer}.grid button.sel{background:#222;color:#fff}.grid button.mid{background:#eee;border-radius:0}.grid button:disabled{color:#ccc}.dow{text-align:center;font-size:11px;color:#777}`,
      script: `const names = ["January","February","March","April","May","June","July","August","September","October","November","December"];
let y = 2026, m = 10, start = null, end = null;
const iso = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
const pretty = (d) => names[d.getMonth()].slice(0, 3) + " " + d.getDate() + ", " + d.getFullYear();
function draw() {
  document.getElementById("month").textContent = names[m] + " " + y;
  const first = new Date(y, m, 1).getDay(), count = new Date(y, m + 1, 0).getDate(), today = new Date(2026, 10, 17);
  let html = ["Su","Mo","Tu","We","Th","Fr","Sa"].map((d) => '<span class="dow">' + d + "</span>").join("") + "<span></span>".repeat(first);
  for (let d = 1; d <= count; d++) {
    const day = new Date(y, m, d), k = iso(day);
    const cls = (start && k === iso(start)) || (end && k === iso(end)) ? "sel" : start && end && day > start && day < end ? "mid" : "";
    html += '<button class="' + cls + '" data-day="' + k + '"' + (day < today ? " disabled" : "") + ">" + d + "</button>";
  }
  const grid = document.getElementById("days"); grid.innerHTML = html;
  grid.querySelectorAll("button[data-day]").forEach((b) => b.addEventListener("click", () => pick(new Date(b.dataset.day + "T00:00"))));
}
function pick(day) {
  if (!start || end || day <= start) { start = day; end = null; } else { end = day; }
  document.getElementById("in").value = start ? pretty(start) : ""; document.getElementById("out").value = end ? pretty(end) : "";
  draw(); if (end) setTimeout(() => document.getElementById("cal").hidden = true, 200);
}
for (const id of ["in", "out"]) document.getElementById(id).addEventListener("click", () => { document.getElementById("cal").hidden = false; draw(); });
document.querySelector('[aria-label="Previous month"]').onclick = () => { if (--m < 0) { m = 11; y--; } draw(); };
document.querySelector('[aria-label="Next month"]').onclick = () => { if (++m > 11) { m = 0; y++; } draw(); };
document.getElementById("go").onclick = () => { report("search", { checkIn: start && iso(start), checkOut: end && iso(end) }); document.getElementById("st").textContent = "Showing 214 stays"; };`,
    }),
  },
  async solve(call, { base }) {
    await call("agent_browser_open", { url: `${base}stays` });
    await call("agent_browser_batch", { steps: [
      { do: "click", selector: "#in" },
      ...Array.from({ length: 4 }, () => ({ do: "click", selector: "role=button[name=\"Next month\"]" })),
      { do: "click", selector: "[data-day=\"2027-03-14\"]" }, { do: "click", selector: "[data-day=\"2027-03-18\"]" },
      { do: "wait", ms: 300 }, { do: "click", selector: "#go" },
    ] });
    return "searched";
  },
};

const slider: BenchTask = {
  id: "slider",
  group: "widgets",
  title: "Custom range slider with drag and arrow keys",
  start: "shop",
  request: ({ base }) => `On ${base}shop, set the maximum price filter to $750 and apply the filters.`,
  check(run) {
    const applied = lastEvent(run, "filter");
    return verdict(applied?.max === 750, applied ? `applied max ${applied.max}` : "not applied");
  },
  routes: {
    shop: () => page("Laptops — Shop", `<aside class="filters"><h3>Filters</h3><div id="label">Max price</div>
<div class="track"><div class="fill"></div><div class="thumb" role="slider" tabindex="0" aria-labelledby="label" aria-valuemin="0" aria-valuemax="2000" aria-valuenow="2000" aria-valuetext="$2,000"></div></div>
<div class="val">Up to <b id="v">$2,000</b></div><button id="apply">Apply filters</button></aside><main><p role="status" id="st">128 laptops</p></main>`, {
      style: `.filters{width:460px;padding:30px}.track{position:relative;width:400px;height:6px;background:#ddd;border-radius:3px;margin:30px 0}.fill{position:absolute;left:0;top:0;bottom:0;background:#2457f5;border-radius:3px}
.thumb{position:absolute;top:-8px;width:22px;height:22px;margin-left:-11px;border-radius:50%;background:#fff;border:2px solid #2457f5;cursor:grab;touch-action:none}#apply{margin-top:16px;padding:8px 14px}main{padding:30px}`,
      script: `const track = document.querySelector(".track"), thumb = document.querySelector(".thumb");
let value = 2000; const step = 50, max = 2000;
function set(v) { value = Math.max(0, Math.min(max, Math.round(v / step) * step)); const p = value / max * 100; thumb.style.left = p + "%"; document.querySelector(".fill").style.width = p + "%";
  thumb.setAttribute("aria-valuenow", value); const t = "$" + value.toLocaleString("en-US"); thumb.setAttribute("aria-valuetext", t); document.getElementById("v").textContent = t; }
set(2000);
thumb.addEventListener("pointerdown", (e) => { thumb.setPointerCapture(e.pointerId); thumb.focus(); });
thumb.addEventListener("pointermove", (e) => { if (!thumb.hasPointerCapture(e.pointerId)) return; const r = track.getBoundingClientRect(); set((e.clientX - r.left) / r.width * max); });
track.addEventListener("pointerdown", (e) => { if (e.target !== track) return; const r = track.getBoundingClientRect(); set((e.clientX - r.left) / r.width * max); });
thumb.addEventListener("keydown", (e) => {
  const d = { ArrowRight: step, ArrowUp: step, ArrowLeft: -step, ArrowDown: -step, PageUp: 250, PageDown: -250 }[e.key];
  if (d) { e.preventDefault(); set(value + d); } else if (e.key === "Home") set(0); else if (e.key === "End") set(max);
});
document.getElementById("apply").onclick = () => { report("filter", { max: value }); document.getElementById("st").textContent = (value / 20 | 0) + " laptops under $" + value; };`,
    }),
  },
  async solve(call, { base }) {
    await call("agent_browser_open", { url: `${base}shop` });
    await call("agent_browser_click", { selector: "role=slider" });
    await call("agent_browser_press", { key: "Home" });
    await call("agent_browser_batch", { steps: [...Array.from({ length: 3 }, () => ({ do: "press", key: "PageUp" })), { do: "click", selector: "#apply" }] });
    return "applied";
  },
};

const shadow: BenchTask = {
  id: "shadow-settings",
  group: "widgets",
  title: "Switches and Save inside closed and open shadow roots",
  start: "settings",
  request: ({ base }) => `On ${base}settings, turn on the Weekly digest email and save. Leave the other settings as they are.`,
  check(run) {
    const saved = lastEvent(run, "settings");
    const ok = saved?.digest === true && saved.product === true && saved.marketing === false;
    return verdict(ok, saved ? `saved ${JSON.stringify(saved)}` : "not saved");
  },
  routes: {
    settings: () => page("Notification settings", `<h1 style="padding:0 30px">Settings</h1><settings-app></settings-app>`, {
      script: `class XSwitch extends HTMLElement {
  constructor() { super(); const root = this.attachShadow({ mode: "open" });
    root.innerHTML = '<style>:host{display:flex;align-items:center;justify-content:space-between;padding:12px 0;border-bottom:1px solid #eee}.s{width:40px;height:22px;border-radius:11px;background:#ccc;position:relative;cursor:pointer}.s[aria-checked=true]{background:#34c759}.s:after{content:"";position:absolute;top:2px;left:2px;width:18px;height:18px;border-radius:50%;background:#fff;transition:left .15s}.s[aria-checked=true]:after{left:20px}</style><span id="l"></span><div class="s" role="switch" tabindex="0" aria-labelledby="l"></div>';
    this.sw = root.querySelector(".s"); this.sw.addEventListener("click", () => this.toggle()); this.sw.addEventListener("keydown", (e) => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); this.toggle(); } }); }
  connectedCallback() { this.shadowRoot.getElementById("l").textContent = this.getAttribute("label"); this.sw.setAttribute("aria-checked", this.hasAttribute("on") ? "true" : "false"); }
  get on() { return this.sw.getAttribute("aria-checked") === "true"; }
  toggle() { this.sw.setAttribute("aria-checked", String(!this.on)); this.dispatchEvent(new Event("change", { bubbles: true, composed: true })); }
}
customElements.define("x-switch", XSwitch);
class SettingsApp extends HTMLElement {
  constructor() { super(); const root = this.attachShadow({ mode: "closed" });
    root.innerHTML = '<style>section{max-width:480px;margin:0 30px}button{margin-top:16px;padding:8px 16px;background:#0a84ff;color:#fff;border:0;border-radius:6px}button:disabled{opacity:.4}</style><section><h2>Email</h2><x-switch id="p" label="Product updates" on></x-switch><x-switch id="d" label="Weekly digest"></x-switch><x-switch id="m" label="Marketing emails"></x-switch><button disabled>Save changes</button><p role="status"></p></section>';
    const save = root.querySelector("button"), st = root.querySelector("p");
    root.addEventListener("change", () => { save.disabled = false; st.textContent = "Unsaved changes"; });
    save.addEventListener("click", () => { report("settings", { product: root.getElementById("p").on, digest: root.getElementById("d").on, marketing: root.getElementById("m").on }); save.disabled = true; st.textContent = "Saved"; });
  }
}
customElements.define("settings-app", SettingsApp);`,
    }),
  },
  async solve(call, { base }) {
    const opened = await call("agent_browser_open", { url: `${base}settings` });
    const ref = (pattern: RegExp, text: string) => pattern.exec(text)?.[1] ?? "";
    const digest = ref(/switch "Weekly digest" \[ref=(e\d+)\]/u, opened);
    await call("agent_browser_click", { ref: digest });
    const snap = await call("agent_browser_snapshot", {});
    await call("agent_browser_click", { ref: ref(/button "Save changes" \[ref=(e\d+)\]/u, snap) });
    return "saved";
  },
};

export const WIDGET_TASKS: BenchTask[] = [combobox, dropdown, datePicker, slider, shadow];
