import { page } from "./site.ts";
import { lastEvent, verdict, type BenchTask } from "./task.ts";

const newsletter: BenchTask = {
  id: "iframe-newsletter",
  group: "frames",
  title: "Signup form inside a cross-site iframe",
  start: "blog",
  request: ({ base }) => `On ${base}blog, subscribe newsletter@example.test to the newsletter in the embedded signup box.`,
  check(run) {
    const sub = lastEvent(run, "subscribe");
    return verdict(sub?.email === "newsletter@example.test" && sub.consent === true, sub ? `subscribed ${JSON.stringify(sub)}` : "not subscribed");
  },
  routes: {
    blog: ({ cross }) => page("The Slow Web — a blog", `<article style="max-width:640px;margin:30px auto"><h1>Why boring tech wins</h1>${"<p>Choosing well-understood tools means fewer surprises at 3am. The best stack is the one your team already knows. </p>".repeat(6)}
<iframe title="Newsletter signup" src="${cross}embed/signup" style="width:100%;height:230px;border:1px solid #ddd;border-radius:8px"></iframe>${"<p>More thoughts on calm software. </p>".repeat(4)}</article>`),
    "embed/signup": () => page("Signup", `<form style="padding:14px;font-family:system-ui" onsubmit="event.preventDefault(); go()"><b>Get one email a month</b>
<p><input type="email" required placeholder="you@example.com" aria-label="Email address" style="padding:8px;width:260px"></p>
<p><label><input type="checkbox" id="c"> I agree to receive emails</label></p><button>Subscribe</button><div id="m" role="status"></div></form>`, {
      script: `function go() { const email = document.querySelector("input[type=email]").value, consent = document.getElementById("c").checked;
  if (!consent) { document.getElementById("m").textContent = "Please tick the consent box."; return; }
  report("subscribe", { email, consent }); document.getElementById("m").textContent = "Thanks! Check your inbox."; }`,
    }),
  },
  async solve(call, { base }) {
    const opened = await call("agent_browser_open", { url: `${base}blog` });
    const ref = (pattern: RegExp) => pattern.exec(opened)?.[1] ?? "";
    await call("agent_browser_fill", { ref: ref(/textbox "Email address" \[ref=(e\d+)\]/u), text: "newsletter@example.test" });
    await call("agent_browser_check", { ref: ref(/checkbox "I agree to receive emails" \[ref=(e\d+)\]/u) });
    await call("agent_browser_click", { ref: ref(/button "Subscribe" \[ref=(e\d+)\]/u) });
    return "subscribed";
  },
};

const FIELD = (kind: string) => page(kind, `<input aria-label="${{ number: "Card number", expiry: "Expiration date MM / YY", cvc: "Security code" }[kind]}" inputmode="numeric" autocomplete="cc-${kind === "number" ? "number" : kind === "expiry" ? "exp" : "csc"}" placeholder="${{ number: "1234 1234 1234 1234", expiry: "MM / YY", cvc: "CVC" }[kind]}" style="border:0;outline:none;width:100%;font-size:16px;padding:10px">`, {
  style: "body{margin:0}",
  script: `const kind = ${JSON.stringify(kind)}, input = document.querySelector("input");
const fmt = { number: (d) => d.slice(0, 16).replace(/(\\d{4})(?=\\d)/g, "$1 "), expiry: (d) => d.length > 2 ? d.slice(0, 2) + " / " + d.slice(2, 4) : d, cvc: (d) => d.slice(0, 4) };
input.addEventListener("input", () => { input.value = fmt[kind](input.value.replace(/\\D/g, "")); parent.postMessage({ field: kind, value: input.value.replace(/\\D/g, "") }, "*"); });`,
});

const payment: BenchTask = {
  id: "payment-iframes",
  group: "frames",
  title: "Checkout with card fields each in its own cross-site iframe",
  start: "checkout",
  request: ({ base }) => `Pay for the order at ${base}checkout with this test card: name Alex Doe, number 4242 4242 4242 4242, expiry 12/34, CVC 123. It's a test checkout, so go ahead and pay.`,
  check(run) {
    const paid = lastEvent(run, "pay");
    const ok = paid?.number === "4242424242424242" && paid.expiry === "1234" && paid.cvc === "123" && String(paid.name).trim() === "Alex Doe";
    return verdict(ok, paid ? `paid ${JSON.stringify(paid)}` : "not paid");
  },
  routes: {
    checkout: ({ cross }) => page("Checkout", `<div class="co"><h2>Pay $24.00</h2><label>Name on card<input id="name" autocomplete="cc-name"></label>
<div class="lbl">Card information</div><div class="box"><iframe title="Secure card number input frame" src="${cross}field/number"></iframe><div class="row"><iframe title="Secure expiration date input frame" src="${cross}field/expiry"></iframe><iframe title="Secure CVC input frame" src="${cross}field/cvc"></iframe></div></div>
<button id="pay">Pay $24.00</button><div id="err" role="alert"></div></div>`, {
      style: `.co{max-width:400px;margin:40px auto;display:flex;flex-direction:column;gap:8px}label{display:flex;flex-direction:column;gap:4px}#name{padding:10px;border:1px solid #ccc;border-radius:6px}.box{border:1px solid #ccc;border-radius:6px}iframe{border:0;width:100%;height:42px;display:block}
.row{display:flex;border-top:1px solid #ccc}.row iframe+iframe{border-left:1px solid #ccc}#pay{padding:12px;background:#635bff;color:#fff;border:0;border-radius:6px}#err{color:#c00}`,
      script: `const card = { number: "", expiry: "", cvc: "" };
addEventListener("message", (e) => { if (e.data && e.data.field) card[e.data.field] = e.data.value; });
document.getElementById("pay").onclick = () => {
  const err = document.getElementById("err");
  if (card.number.length !== 16) return err.textContent = "Your card number is incomplete.";
  if (card.expiry.length !== 4) return err.textContent = "Your card's expiration date is incomplete.";
  if (card.cvc.length < 3) return err.textContent = "Your card's security code is incomplete.";
  report("pay", { ...card, name: document.getElementById("name").value }); err.textContent = ""; document.querySelector(".co").innerHTML = "<h2>Payment successful</h2>";
};`,
    }),
    "field/number": () => FIELD("number"),
    "field/expiry": () => FIELD("expiry"),
    "field/cvc": () => FIELD("cvc"),
  },
  async solve(call, { base }) {
    const opened = await call("agent_browser_open", { url: `${base}checkout` });
    const ref = (label: string) => new RegExp(`textbox "${label}" \\[ref=(e\\d+)\\]`, "u").exec(opened)?.[1] ?? "";
    await call("agent_browser_batch", { steps: [
      { do: "fill", selector: "#name", text: "Alex Doe" },
      { do: "type", ref: ref("Card number"), text: "4242424242424242" },
      { do: "type", ref: ref("Expiration date MM / YY"), text: "1234" },
      { do: "type", ref: ref("Security code"), text: "123" },
      { do: "click", selector: "#pay" },
    ] });
    return "paid";
  },
};

const popup: BenchTask = {
  id: "oauth-popup",
  group: "frames",
  title: "Sign-in popup window that reports back to its opener",
  start: "integrations",
  request: ({ base }) => `On ${base}integrations, connect the calendar using the work account alex@work.test.`,
  check(run) {
    const connected = lastEvent(run, "connect");
    return verdict(connected?.account === "alex@work.test", connected ? `connected ${connected.account}` : "not connected");
  },
  routes: {
    integrations: ({ cross }) => page("Integrations", `<div style="max-width:520px;margin:40px auto"><h2>Integrations</h2><div class="card"><b>Calendar</b><p id="state">Not connected</p><button id="connect">Connect calendar</button></div></div>`, {
      style: ".card{border:1px solid #ddd;border-radius:8px;padding:16px}",
      script: `document.getElementById("connect").onclick = () => window.open(${JSON.stringify(`${cross}oauth/authorize?client=flowboard`)}, "oauth", "width=480,height=640");
addEventListener("message", (e) => { if (e.data && e.data.oauth) { report("connect", { account: e.data.account }); document.getElementById("state").textContent = "Connected as " + e.data.account; document.getElementById("connect").remove(); } });`,
    }),
    "oauth/authorize": () => page("Sign in - CalendarHub", `<div style="max-width:380px;margin:30px auto"><h3>Choose an account</h3><p>to continue to Flowboard</p>
<div role="radiogroup" aria-label="Accounts"><label class="acct"><input type="radio" name="a" value="alex.doe@personal.test"> Alex Doe · alex.doe@personal.test</label><label class="acct"><input type="radio" name="a" value="alex@work.test"> Alex Doe · alex@work.test</label></div>
<div id="consent" hidden><p>Flowboard wants to see and edit your calendars.</p><button id="allow">Allow</button> <button id="deny">Cancel</button></div></div>`, {
      style: ".acct{display:block;padding:12px;border:1px solid #ddd;border-radius:8px;margin:6px 0;cursor:pointer}#allow{background:#1a73e8;color:#fff;border:0;padding:8px 16px;border-radius:4px}",
      script: `let account = null;
document.querySelectorAll("input[name=a]").forEach((r) => r.addEventListener("change", () => { account = r.value; document.getElementById("consent").hidden = false; }));
document.getElementById("allow").onclick = () => { opener && opener.postMessage({ oauth: true, account }, "*"); setTimeout(() => close(), 100); };
document.getElementById("deny").onclick = () => close();`,
    }),
  },
  async solve(call, { base }) {
    await call("agent_browser_open", { url: `${base}integrations` });
    const clicked = await call("agent_browser_click", { selector: "#connect" });
    const tab = /new tab (t\d+)/u.exec(clicked)?.[1];
    if (!tab) throw new Error(`no popup tab: ${clicked}`);
    await call("agent_browser_tabs", { action: "switch", tab });
    await call("agent_browser_wait", { text: "Choose an account", tab });
    await call("agent_browser_check", { selector: "input[value=\"alex@work.test\"]", tab });
    await call("agent_browser_click", { selector: "#allow", tab });
    return "connected";
  },
};

export const FRAME_TASKS: BenchTask[] = [newsletter, payment, popup];
