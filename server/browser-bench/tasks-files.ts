import { join } from "node:path";

import { page } from "./site.ts";
import { answerHas, lastEvent, verdict, type BenchTask } from "./task.ts";

const RECEIPT = "%PDF-1.4 bench receipt 0412 total 86.40 EUR";

const upload: BenchTask = {
  id: "file-upload",
  group: "files",
  title: "Hidden file input behind a styled dropzone, then submit",
  start: "expenses/new",
  files: { "receipt-0412.pdf": RECEIPT },
  request: ({ base, files }) => `File an expense at ${base}expenses/new for "Team lunch", 86.40, with the receipt at ${join(files, "receipt-0412.pdf")} attached.`,
  check(run) {
    const filed = lastEvent(run, "expense");
    const ok = filed?.file === "receipt-0412.pdf" && filed.content === RECEIPT && filed.title === "Team lunch" && Number(filed.amount) === 86.4;
    return verdict(ok, filed ? `filed ${JSON.stringify({ ...filed, content: String(filed.content).slice(0, 20) })}` : "not filed");
  },
  routes: {
    "expenses/new": () => page("New expense", `<form class="f" onsubmit="event.preventDefault(); go()"><h2>New expense</h2><label>Description<input name="title"></label><label>Amount (EUR)<input name="amount" inputmode="decimal"></label>
<label class="drop"><input type="file" accept=".pdf,.png,.jpg" hidden><span>📎 Drag a receipt here or <u>browse files</u></span></label><div id="chosen"></div><button>Submit expense</button><p id="err" role="alert"></p></form>`, {
      style: ".f{max-width:420px;margin:40px auto;display:flex;flex-direction:column;gap:10px}label{display:flex;flex-direction:column;gap:4px}input{padding:8px}.drop{border:2px dashed #aaa;border-radius:10px;padding:26px;text-align:center;cursor:pointer;color:#555}button{padding:10px;background:#0a7;color:#fff;border:0;border-radius:6px}",
      script: `const file = document.querySelector("input[type=file]");
file.addEventListener("change", () => { document.getElementById("chosen").textContent = file.files[0] ? "Attached: " + file.files[0].name : ""; });
async function go() {
  const f = file.files[0]; if (!f) { document.getElementById("err").textContent = "Attach a receipt."; return; }
  report("expense", { title: document.querySelector("[name=title]").value, amount: document.querySelector("[name=amount]").value, file: f.name, content: await f.text() });
  document.querySelector(".f").innerHTML = "<h2>Expense submitted</h2>";
}`,
    }),
  },
  async solve(call, { base, files }) {
    await call("agent_browser_open", { url: `${base}expenses/new` });
    await call("agent_browser_batch", { steps: [
      { do: "fill", selector: "[name=title]", text: "Team lunch" }, { do: "fill", selector: "[name=amount]", text: "86.40" },
    ] });
    await call("agent_browser_upload", { selector: "input[type=file]", files: [join(files, "receipt-0412.pdf")] });
    await call("agent_browser_click", { selector: "text=Submit expense" });
    return "filed";
  },
};

const download: BenchTask = {
  id: "download",
  group: "files",
  title: "Export behind a row's icon menu that downloads a file",
  start: "reports",
  request: ({ base }) => `Download the March 2026 report as CSV from ${base}reports and tell me the name of the file you got.`,
  check(run, answer) {
    const fetched = run.requests.some((request) => request.startsWith("GET export/2026-03.csv"));
    if (!fetched) return verdict(false, "March CSV never downloaded");
    return answerHas(answer, "acme-report-2026-03.csv");
  },
  routes: {
    reports: () => page("Reports", `<main style="max-width:640px;margin:30px auto"><h1>Monthly reports</h1>${["2026-04:April 2026", "2026-03:March 2026", "2026-02:February 2026"].map((row) => {
      const [id, name] = row.split(":");
      return `<div class="row"><span>${name}</span><div class="more"><button aria-label="More actions" aria-haspopup="menu" class="dots">⋯</button><div class="menu" role="menu" hidden><a role="menuitem" href="export/${id}.csv">Download CSV</a><a role="menuitem" href="export/${id}.pdf">Download PDF</a></div></div></div>`;
    }).join("")}</main>`, {
      style: ".row{display:flex;justify-content:space-between;align-items:center;padding:14px;border-bottom:1px solid #eee}.more{position:relative}.dots{border:0;background:none;font-size:20px;cursor:pointer}.menu{position:absolute;right:0;top:100%;background:#fff;box-shadow:0 4px 12px #0003;display:flex;flex-direction:column;min-width:150px;z-index:2}.menu[hidden]{display:none}.menu a{padding:9px 12px;color:#222;text-decoration:none}.menu a:hover{background:#eee}",
      script: `document.querySelectorAll(".dots").forEach((b) => b.onclick = (e) => { e.stopPropagation(); document.querySelectorAll(".menu").forEach((m) => { if (m !== b.nextElementSibling) m.hidden = true; }); b.nextElementSibling.hidden = !b.nextElementSibling.hidden; });
document.addEventListener("click", () => document.querySelectorAll(".menu").forEach((m) => m.hidden = true));`,
    }),
    "export/*": ({ path }) => {
      const name = path.slice("export/".length);
      return { type: name.endsWith(".pdf") ? "application/pdf" : "text/csv", headers: { "content-disposition": `attachment; filename="acme-report-${name}"` }, body: name.endsWith(".csv") ? "month,revenue\n2026-03,44105\n" : "%PDF-1.4" };
    },
  },
  async solve(call, { base }) {
    await call("agent_browser_open", { url: `${base}reports` });
    await call("agent_browser_eval", { expression: "document.querySelectorAll('.dots')[1].id = 'march', true" });
    await call("agent_browser_click", { selector: "#march" });
    await call("agent_browser_click", { selector: "a[href=\"export/2026-03.csv\"]" });
    await call("agent_browser_wait", { ms: 800 });
    return await call("agent_browser_status", {});
  },
};

const signup: BenchTask = {
  id: "signup-form",
  group: "files",
  title: "Form with a phone mask, native select, radios, terms and validation",
  start: "join",
  request: ({ base }) => `Create an account at ${base}join for Jamie Rivera, email jamie@rivera.test, phone 415 555 0132, role Engineering, team size 11-50, and accept the terms. It's a test site.`,
  check(run) {
    const made = lastEvent(run, "signup");
    const ok = made?.name === "Jamie Rivera" && made.email === "jamie@rivera.test" && made.phone === "(415) 555-0132" && made.role === "eng" && made.size === "11-50" && made.terms === true;
    return verdict(ok, made ? `created ${JSON.stringify(made)}` : "not created");
  },
  routes: {
    join: () => page("Create your account", `<form class="f" novalidate onsubmit="event.preventDefault(); go()"><h2>Create your account</h2>
<label>Full name<input name="name" autocomplete="name"></label><label>Work email<input name="email" type="email"><small class="e" id="email-err"></small></label>
<label>Phone<input name="phone" type="tel" placeholder="(555) 123-4567"></label>
<label>Role<select name="role"><option value="">Choose…</option><option value="eng">Engineering</option><option value="design">Design</option><option value="pm">Product</option><option value="other">Other</option></select></label>
<fieldset><legend>Team size</legend>${["1-10", "11-50", "51-200", "200+"].map((size) => `<label class="r"><input type="radio" name="size" value="${size}"> ${size}</label>`).join("")}</fieldset>
<label class="r"><input type="checkbox" name="terms"> I accept the Terms and Privacy Policy</label><button id="submit">Create account</button><p id="err" role="alert"></p></form>`, {
      style: ".f{max-width:420px;margin:30px auto;display:flex;flex-direction:column;gap:10px}label{display:flex;flex-direction:column;gap:4px}.r{flex-direction:row;gap:6px}input,select{padding:8px}fieldset{border:1px solid #ddd}.e,#err{color:#c00}button{padding:10px;background:#5b3df5;color:#fff;border:0;border-radius:6px}",
      script: `const f = document.querySelector(".f"), phone = f.phone;
phone.addEventListener("input", () => { const d = phone.value.replace(/\\D/g, "").slice(0, 10); phone.value = d.length > 6 ? "(" + d.slice(0, 3) + ") " + d.slice(3, 6) + "-" + d.slice(6) : d.length > 3 ? "(" + d.slice(0, 3) + ") " + d.slice(3) : d; });
f.email.addEventListener("blur", () => { document.getElementById("email-err").textContent = /^[^@\\s]+@[^@\\s]+\\.[a-z]{2,}$/i.test(f.email.value) ? "" : "Enter a valid email."; });
function go() {
  const v = { name: f.name.value.trim(), email: f.email.value.trim(), phone: phone.value, role: f.role.value, size: (f.querySelector("[name=size]:checked") || {}).value, terms: f.terms.checked };
  const missing = [!v.name && "name", !/^[^@\\s]+@[^@\\s]+\\.[a-z]{2,}$/i.test(v.email) && "email", !/^\\(\\d{3}\\) \\d{3}-\\d{4}$/.test(v.phone) && "phone", !v.role && "role", !v.size && "team size", !v.terms && "terms"].filter(Boolean);
  if (missing.length) { document.getElementById("err").textContent = "Please complete: " + missing.join(", "); return; }
  report("signup", v); f.innerHTML = "<h2>Welcome aboard, " + v.name.split(" ")[0] + "!</h2>";
}`,
    }),
  },
  async solve(call, { base }) {
    await call("agent_browser_open", { url: `${base}join` });
    await call("agent_browser_batch", { steps: [
      { do: "fill", selector: "[name=name]", text: "Jamie Rivera" }, { do: "fill", selector: "[name=email]", text: "jamie@rivera.test" },
      { do: "type", selector: "[name=phone]", text: "4155550132" }, { do: "select", selector: "[name=role]", values: ["Engineering"] },
      { do: "check", selector: "input[value=\"11-50\"]" }, { do: "check", selector: "[name=terms]" }, { do: "click", selector: "#submit" },
    ] });
    return "created";
  },
};

export const FILE_TASKS: BenchTask[] = [upload, download, signup];
