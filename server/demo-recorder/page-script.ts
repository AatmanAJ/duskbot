// The recorder as it runs inside a page: it names what a person acts on (role, accessible name, the words beside a
// field) and finds those elements again by the same words. Security: the script never reads the value of a field the
// page keeps private (the rule the browser's own snapshots use, plus every field that was ever a password box), and it
// keeps no point on screen. On the CDP driver it runs in the isolated world; a page that shares its world could forge
// events, so the server treats everything it answers as data (./capture.ts).
import type { DemoStepKind, DemoTarget } from "../../shared/demo-recording.ts";
import { SENSITIVE_FIELD_PATTERN } from "../browser/cdp/sensitive.ts";

/** The attribute a found element carries while the replayer acts on it. */
export const DEMO_MARK = "data-dusk-demo";

const GLOBAL = "__duskDemo";
const STASH = "__dusk_demo_queue";
/** How a later evaluation reaches the recorder: an event on the document, with the request and the answer left where
 * every script world of the page can read them. agent-browser 0.37 may evaluate each expression in a world of its own,
 * where a global the recorder set is not there. */
const CALL_EVENT = "dusk-demo:call";
const CALL_IN = "__dusk_demo_in";
const CALL_OUT = "__dusk_demo_out";
const MAX_QUEUE = 800;
/** One read answers at most this many events, so the answer stays under the browser's 64 KB evaluation result. */
const DRAIN_MAX = 60;
/** A document that started to leave and is still here this much later is staying: a download, or a cancelled navigation. */
const LEAVING_MS = 6_000;
export const DEMO_TEXT_MAX = 200;
export const DEMO_VALUE_MAX = 2_000;

const SOURCE = String.raw`(() => {
  if (window.top !== window) return "frame";
  if (window[GLOBAL]) return "installed";
  // Left where every script world of this document reads it: session storage, or the root element where a page has none.
  const leave = (key, value) => {
    try { sessionStorage.setItem(key, value); return; } catch (error) {}
    if (document.documentElement) document.documentElement.setAttribute("data-" + key.replace(/_/g, "-"), value);
  };
  const collect = (key) => {
    let value = null;
    try { value = sessionStorage.getItem(key); if (value !== null) sessionStorage.removeItem(key); } catch (error) {}
    const root = document.documentElement;
    const name = "data-" + key.replace(/_/g, "-");
    if (value === null && root && root.hasAttribute(name)) { value = root.getAttribute(name); root.removeAttribute(name); }
    return value;
  };
  // Another world of this document already records: this one adds nothing.
  leave(CALL_IN, JSON.stringify({ do: "ping" }));
  document.dispatchEvent(new Event(CALL_EVENT));
  collect(CALL_IN);
  if (collect(CALL_OUT) !== null) return "installed";
  const queue = [];
  // The recording this document is part of; empty while nobody records, when nothing is kept.
  let take = "";
  let carried = null;
  let opened = false;
  const everPrivate = new WeakSet();
  const formIds = new WeakMap();
  let formCount = 0;
  let lastUrl = location.href;
  let lastScroll = 0;
  let leavingAt = 0;

  const clean = (text, max) => String(text == null ? "" : text).replace(/\s+/g, " ").trim().slice(0, max || TEXT_MAX);
  const textOf = (el) => clean(el.innerText != null ? el.innerText : el.textContent);
  const tagOf = (el) => (el && el.tagName ? el.tagName.toLowerCase() : "");
  const typeOf = (el) => (tagOf(el) === "input" ? (el.getAttribute("type") || "text").toLowerCase() : "");
  const isControl = (el) => ["input", "select", "textarea"].includes(tagOf(el)) && typeOf(el) !== "hidden";
  const TEXT_TYPES = ["text", "search", "email", "tel", "url", "password", "number", "date", "time", "datetime-local", "month", "week", "color"];
  const isTextField = (el) => tagOf(el) === "textarea" || (tagOf(el) === "input" && TEXT_TYPES.includes(typeOf(el))) || (el.isContentEditable === true && !isControl(el));
  const INTERACTIVE = 'a[href], button, summary, input:not([type="hidden"]), select, textarea, option, [contenteditable=""], [contenteditable="true"], [onclick], '
    + '[role="button"], [role="link"], [role="checkbox"], [role="radio"], [role="switch"], [role="tab"], [role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"], [role="option"], [role="combobox"], [role="textbox"], [role="searchbox"], [role="slider"], [role="spinbutton"], [role="treeitem"]';

  const visible = (el) => {
    if (!el || !el.isConnected) return false;
    if (el.getClientRects && el.getClientRects().length === 0) return false;
    const style = getComputedStyle(el);
    return style.visibility !== "hidden" && style.visibility !== "collapse" && style.display !== "none";
  };

  const roleOf = (el) => {
    const explicit = clean(el.getAttribute("role")).split(" ")[0];
    if (explicit) return explicit.toLowerCase();
    const tag = tagOf(el);
    if (tag === "a") return el.hasAttribute("href") ? "link" : "generic";
    if (tag === "button" || tag === "summary") return "button";
    if (tag === "select") return el.multiple || Number(el.getAttribute("size")) > 1 ? "listbox" : "combobox";
    if (tag === "textarea") return "textbox";
    if (tag === "input") {
      const type = typeOf(el);
      if (["button", "submit", "reset", "image"].includes(type)) return "button";
      if (type === "checkbox" || type === "radio") return type;
      if (type === "file") return "file";
      if (type === "range") return "slider";
      if (type === "number") return "spinbutton";
      if (type === "search") return "searchbox";
      return type === "hidden" ? "generic" : "textbox";
    }
    if (tag === "option") return "option";
    if (tag === "img") return "img";
    if (tag === "p") return "paragraph";
    if (tag === "form") return "form";
    if (tag === "nav") return "navigation";
    if (/^h[1-6]$/.test(tag)) return "heading";
    if (el.isContentEditable === true) return "textbox";
    return "generic";
  };

  const byIds = (ids) => clean(String(ids).split(/\s+/).map((id) => { const found = id && document.getElementById(id); return found ? textOf(found) : ""; }).join(" "));

  // The accessible name from what the page says the element is called; a placeholder is kept apart.
  const nameOf = (el) => {
    const labelledBy = el.getAttribute("aria-labelledby");
    if (labelledBy) { const text = byIds(labelledBy); if (text) return text; }
    const ariaLabel = clean(el.getAttribute("aria-label"));
    if (ariaLabel) return ariaLabel;
    const tag = tagOf(el);
    const type = typeOf(el);
    if (tag === "input" && ["button", "submit", "reset"].includes(type)) return clean(el.value) || (type === "submit" ? "Submit" : type === "reset" ? "Reset" : "");
    if (tag === "input" && type === "image") return clean(el.getAttribute("alt")) || clean(el.getAttribute("title")) || "Submit";
    if (isControl(el)) {
      const labels = el.labels && el.labels.length ? Array.from(el.labels) : [];
      const wrapping = el.closest ? el.closest("label") : null;
      if (wrapping && !labels.includes(wrapping)) labels.push(wrapping);
      const text = clean(labels.map(textOf).join(" "));
      return text || clean(el.getAttribute("title"));
    }
    if (tag === "img") return clean(el.getAttribute("alt")) || clean(el.getAttribute("title"));
    const role = roleOf(el);
    if (["button", "link", "checkbox", "radio", "switch", "tab", "menuitem", "menuitemcheckbox", "menuitemradio", "option", "treeitem", "heading"].includes(role)) return textOf(el) || clean(el.getAttribute("title"));
    return clean(el.getAttribute("title"));
  };

  const BLOCKS = ["table", "form", "fieldset", "ul", "ol", "select", "textarea", "input", "button", "iframe", "nav", "section", "article", "hr"];
  const captionOf = (node) => {
    if (!node) return null;
    if (node.nodeType === 3) return clean(node.nodeValue, 80);
    if (node.nodeType !== 1) return "";
    const tag = tagOf(node);
    if (BLOCKS.includes(tag) || node.querySelector("input, select, textarea, button, table, a[href]")) return null;
    return clean(node.innerText != null ? node.innerText : node.textContent, 80);
  };
  const tidyLabel = (text) => clean(String(text || "").replace(/[\s:*]+$/, ""), 80);

  // The words beside a field with no label of its own: the cell before it in a table, or the text just before it.
  const labelOf = (el) => {
    if (!isControl(el) && !isTextField(el)) return "";
    const cell = el.closest ? el.closest("td, th") : null;
    if (cell && cell.parentElement) {
      for (let before = cell.previousElementSibling; before; before = before.previousElementSibling) {
        const text = before.querySelector("input, select, textarea") ? "" : tidyLabel(textOf(before));
        if (text) return text;
        if (before.querySelector("input, select, textarea")) break;
      }
      const row = cell.parentElement;
      const table = row.closest("table");
      const at = Array.from(row.children).indexOf(cell);
      const head = table && table.querySelector("thead tr, tr");
      const header = head && head !== row ? head.children[at] : null;
      if (header && tagOf(header) === "th") { const text = tidyLabel(textOf(header)); if (text) return text; }
    }
    for (let node = el, depth = 0; node && depth < 2; node = node.parentElement, depth += 1) {
      for (let before = node.previousSibling; before; before = before.previousSibling) {
        const text = captionOf(before);
        if (text === null) return "";
        if (text) return tidyLabel(text);
      }
      if (node.parentElement && ["td", "th", "form", "body", "fieldset", "tr"].includes(tagOf(node.parentElement))) break;
    }
    return "";
  };

  const groupOf = (el) => {
    const set = el.closest ? el.closest('fieldset, [role="group"], [role="radiogroup"]') : null;
    if (!set) return "";
    if (tagOf(set) === "fieldset") { const legend = set.querySelector("legend"); if (legend) return textOf(legend); }
    const labelledBy = set.getAttribute("aria-labelledby");
    return (labelledBy && byIds(labelledBy)) || clean(set.getAttribute("aria-label"));
  };

  const sectionOf = (el) => {
    const group = groupOf(el);
    if (group) return group;
    const headings = Array.from(document.querySelectorAll("h1, h2, h3, h4, h5, h6, legend"));
    let found = "";
    for (const heading of headings) {
      if (heading.compareDocumentPosition(el) & 4) found = textOf(heading) || found;
      else break;
    }
    return found;
  };

  const SENSITIVE = new RegExp(SENSITIVE_SOURCE, SENSITIVE_FLAGS);
  const privateWords = (el, name, label) => {
    const raw = [el.getAttribute("autocomplete"), el.getAttribute("name"), el.id, el.getAttribute("placeholder"), el.getAttribute("aria-label"), name, label].filter(Boolean).join(" ");
    const words = raw.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[^A-Za-z0-9]+/g, " ").trim().toLowerCase();
    return SENSITIVE.test(raw) || /(?:^| )(pin|security code|passphrase|pass phrase|secret|token|auth code|authentication code|authenticator code|access code|login code|2 ?fa code|two factor code|mfa code)(?: |$)/.test(words);
  };
  const isPrivate = (el, name, label) => {
    if (!isControl(el) && !isTextField(el)) return false;
    if (everPrivate.has(el)) return true;
    if (typeOf(el) === "password" || privateWords(el, name, label)) { everPrivate.add(el); return true; }
    return false;
  };
  const notePasswords = (root) => {
    if (!root || !root.querySelectorAll) return;
    if (tagOf(root) === "input" && typeOf(root) === "password") everPrivate.add(root);
    for (const field of root.querySelectorAll('input[type="password"]')) everPrivate.add(field);
  };

  const formOf = (el) => {
    const form = el.form || (el.closest ? el.closest("form") : null);
    if (!form) return 0;
    if (!formIds.has(form)) formIds.set(form, ++formCount);
    return formIds.get(form);
  };

  const sameWords = (a, b) => roleOf(a) === roleOf(b) && nameOf(a) === nameOf(b) && labelOf(a) === labelOf(b);

  const describe = (el, interactive) => {
    const role = roleOf(el);
    const named = interactive || isControl(el);
    const name = named ? nameOf(el) : "";
    const label = named && !name ? labelOf(el) : "";
    const target = { role, name, tag: tagOf(el) };
    if (label) target.label = label;
    const placeholder = clean(el.getAttribute("placeholder"));
    if (placeholder) target.placeholder = placeholder;
    const testId = clean(el.getAttribute("data-testid") || el.getAttribute("data-test-id") || el.getAttribute("data-test"), 80);
    if (testId) target.testId = testId;
    const type = typeOf(el);
    if (type) target.inputType = type;
    if (role === "radio") { const group = groupOf(el); if (group) target.within = group; }
    else if (interactive && (name || label)) {
      const alike = Array.from(document.querySelectorAll(INTERACTIVE)).filter((other) => visible(other) && sameWords(other, el));
      if (alike.length > 1) { const section = sectionOf(el); if (section && section !== name) target.within = section; }
    }
    const form = formOf(el);
    if (form) target.form = form;
    if (type === "password") {
      const scope = el.form || (el.closest ? el.closest("form") : null) || document;
      target.passwords = Array.from(scope.querySelectorAll('input[type="password"]')).filter(visible).length;
      target.fields = Array.from(scope.querySelectorAll("input, textarea, select")).filter((other) => isControl(other) && typeOf(other) !== "password" && !["submit", "button", "reset", "image", "checkbox", "radio"].includes(typeOf(other)) && visible(other)).length;
      if (/new-password/i.test(el.getAttribute("autocomplete") || "")) target.newPassword = true;
    }
    if (isPrivate(el, name, label)) target.sensitive = true;
    if (interactive) target.interactive = true;
    if (isTextField(el)) target.editable = true;
    return target;
  };

  const push = (type, el, extra) => {
    if (!take) return;
    const event = { at: Date.now(), type, url: location.href };
    if (el) {
      const control = el.closest ? el.closest(INTERACTIVE) : null;
      event.target = control ? describe(control, true) : describe(el, false);
    }
    if (extra) Object.assign(event, extra);
    queue.push(event);
    if (queue.length > MAX_QUEUE) queue.splice(0, queue.length - MAX_QUEUE);
  };

  const origin = (event) => {
    const path = event.composedPath ? event.composedPath() : [];
    const first = path.length ? path[0] : event.target;
    return first && first.nodeType === 1 ? first : first && first.parentElement ? first.parentElement : null;
  };

  const valueOf = (el) => clean0(el.isContentEditable === true && !isControl(el) ? (el.innerText != null ? el.innerText : el.textContent) : el.value);
  const clean0 = (text) => String(text == null ? "" : text).slice(0, VALUE_MAX);

  const onField = (type) => (event) => {
    const el = origin(event);
    if (!el) return;
    const tag = tagOf(el);
    const kind = typeOf(el);
    if (tag === "select") {
      if (type !== "change") return;
      const picked = el.multiple ? Array.from(el.options || []).filter((option) => option.selected) : [el.options && el.options[el.selectedIndex]];
      const chosen = picked.filter(Boolean).map((option) => clean(option.label || option.textContent));
      push("change", el, { option: chosen.join(", "), value: clean0(el.value) });
      return;
    }
    if (kind === "checkbox" || kind === "radio") {
      if (type === "change") push("change", el, { checked: el.checked === true });
      return;
    }
    if (kind === "file") {
      if (type === "change") push("change", el, { files: Array.from(el.files || []).slice(0, 20).map((file) => clean(file.name)) });
      return;
    }
    if (!isTextField(el)) return;
    if (isPrivate(el, nameOf(el), labelOf(el))) push(type, el);
    else push(type, el, { value: valueOf(el) });
  };

  // A link followed or a form sent leaves this document a moment later. Until it has gone the page says it is on its
  // way out, so the replayer never acts on a document that is about to be replaced.
  const sameTab = (el) => { const target = clean(el.getAttribute("target")).toLowerCase(); return !target || target === "_self"; };
  const plainClick = (event) => event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
  document.addEventListener("click", (event) => {
    const el = origin(event);
    if (!el) return;
    push("click", el);
    const link = el.closest ? el.closest("a[href]") : null;
    if (link && plainClick(event) && sameTab(link) && !link.hasAttribute("download") && /^https?:/.test(link.href) && link.href.split("#")[0] !== location.href.split("#")[0]) leavingAt = Date.now();
  }, true);
  addEventListener("click", (event) => { if (event.defaultPrevented) leavingAt = 0; });
  addEventListener("submit", (event) => { if (event.defaultPrevented) leavingAt = 0; });
  document.addEventListener("input", onField("input"), true);
  document.addEventListener("change", onField("change"), true);
  document.addEventListener("keydown", (event) => {
    if (!["Enter", "Escape", "Tab"].includes(event.key)) return;
    const el = origin(event);
    push("key", el && el !== document.body ? el : null, { key: event.key });
  }, true);
  document.addEventListener("submit", (event) => {
    const el = origin(event);
    if (!el) return;
    push("submit", el);
    if (sameTab(el)) leavingAt = Date.now();
  }, true);
  document.addEventListener("focusin", (event) => { const el = origin(event); if (el) { notePasswords(el); push("focus", el); } }, true);
  document.addEventListener("focusout", (event) => { const el = origin(event); if (el) push("blur", el); }, true);
  document.addEventListener("scroll", () => {
    const now = Date.now();
    if (now - lastScroll < 500) return;
    lastScroll = now;
    push("scroll", null);
  }, true);

  // The script runs before the page's own on the CDP driver, when the document has no element yet: the document node itself is watched.
  notePasswords(document);
  if (typeof MutationObserver === "function") {
    try {
      new MutationObserver((records) => {
        for (const record of records) {
          if (record.type === "attributes") { if (record.oldValue === "password" || typeOf(record.target) === "password") everPrivate.add(record.target); }
          else for (const node of record.addedNodes) notePasswords(node);
        }
      }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ["type"], attributeOldValue: true });
    } catch (error) {}
  }

  // A page that is left before it is read hands what it saw to the next document of the same site, for the same recording only.
  try {
    const stashed = sessionStorage.getItem(STASH);
    if (stashed) {
      sessionStorage.removeItem(STASH);
      const left = JSON.parse(stashed);
      if (left && typeof left.take === "string" && Array.isArray(left.events)) carried = { take: left.take, events: left.events.slice(-MAX_QUEUE) };
    }
  } catch (error) {}
  addEventListener("pagehide", () => {
    try { if (take && queue.length) sessionStorage.setItem(STASH, JSON.stringify({ take, events: queue })); } catch (error) {}
  });
  addEventListener("beforeunload", () => { leavingAt = Date.now(); });

  const listen = (id) => {
    if (typeof id !== "string" || !id) return;
    if (take !== id) { take = id; queue.length = 0; opened = false; }
    if (carried && carried.take === id) queue.unshift(...carried.events);
    carried = null;
    if (!opened) { opened = true; lastUrl = location.href; push("open", null); }
  };
  const forget = () => {
    take = "";
    queue.length = 0;
    carried = null;
    opened = false;
    try { sessionStorage.removeItem(STASH); } catch (error) {}
    return JSON.stringify({ ok: true });
  };
  listen(INITIAL_TAKE);

  const loose = (text) => clean(text).replace(/[\s:*]+$/, "").toLowerCase();
  const wordsOf = (el) => { const name = nameOf(el); return { name, label: name ? "" : labelOf(el), placeholder: clean(el.getAttribute("placeholder")) }; };
  const candidates = (role) => Array.from(document.querySelectorAll("*")).filter((el) => roleOf(el) === role && (role === "file" || visible(el)));

  const narrow = (found, target) => {
    if (found.length > 1 && target.within) {
      const inGroup = found.filter((el) => groupOf(el) === target.within || sectionOf(el) === target.within);
      if (inGroup.length) found = inGroup;
    }
    if (found.length > 1 && found.every((el) => tagOf(el) === "a" && el.href && el.href === found[0].href)) found = [found[0]];
    return found;
  };

  const locate = (target) => {
    const all = candidates(target.role);
    if (target.testId) {
      const byId = all.filter((el) => clean(el.getAttribute("data-testid") || el.getAttribute("data-test-id") || el.getAttribute("data-test"), 80) === target.testId);
      if (byId.length === 1) return byId;
    }
    const wanted = target.name || target.label || "";
    const described = all.map((el) => ({ el, words: wordsOf(el) }));
    const tiers = [
      (words) => (target.name ? words.name === target.name : Boolean(target.label) && !words.name && words.label === target.label),
      (words) => Boolean(wanted) && (words.name === wanted || words.label === wanted),
      (words) => Boolean(wanted) && (loose(words.name) === loose(wanted) || loose(words.label) === loose(wanted)),
      (words) => !wanted && Boolean(target.placeholder) && words.placeholder === target.placeholder,
    ];
    for (const tier of tiers) {
      const found = narrow(described.filter(({ words }) => tier(words)).map(({ el }) => el), target);
      if (found.length) return found;
    }
    return [];
  };

  const disabledOf = (el) => el.disabled === true || el.getAttribute("aria-disabled") === "true" || Boolean(el.closest && el.closest("fieldset[disabled]"));
  const optionOf = (el, value) => {
    const options = Array.from(el.options || []);
    const label = (option) => clean(option.label || option.textContent);
    return options.find((option) => label(option) === clean(value)) || options.find((option) => loose(label(option)) === loose(value)) || options.find((option) => option.value === value) || null;
  };
  const marked = (nonce) => document.querySelector("[" + MARK + '="' + nonce + '"]');
  const answer = (el, nonce, extra) => {
    unmark(nonce);
    el.setAttribute(MARK, nonce);
    const words = wordsOf(el);
    const found = { count: 1, selector: "[" + MARK + '="' + nonce + '"]', tag: tagOf(el), disabled: disabledOf(el), sensitive: isPrivate(el, words.name, words.label) };
    const type = typeOf(el);
    if (type) found.inputType = type;
    if (type === "checkbox" || type === "radio") found.checked = el.checked === true;
    else if (el.getAttribute("aria-checked")) found.checked = el.getAttribute("aria-checked") === "true";
    return JSON.stringify(Object.assign(found, extra || {}));
  };

  const find = (target, options) => {
    const nonce = String(options.nonce);
    if (options.kind === "choose" && target.role === "radiogroup") {
      const radios = candidates("radio").filter((el) => groupOf(el) === target.name || loose(groupOf(el)) === loose(target.name));
      if (!radios.length) return JSON.stringify({ count: 0 });
      const wanted = String(options.value == null ? "" : options.value);
      const picks = radios.filter((el) => nameOf(el) === wanted);
      const loosely = picks.length ? picks : radios.filter((el) => loose(nameOf(el)) === loose(wanted));
      if (loosely.length !== 1) return JSON.stringify({ count: 1, option: false });
      return answer(loosely[0], nonce, { option: true });
    }
    const found = locate(target);
    if (found.length !== 1) return JSON.stringify({ count: found.length });
    const el = found[0];
    if (options.kind === "select") return answer(el, nonce, { option: Boolean(optionOf(el, String(options.value == null ? "" : options.value))) });
    return answer(el, nonce);
  };

  const setValue = (el, value) => {
    const proto = tagOf(el) === "textarea" ? HTMLTextAreaElement.prototype : tagOf(el) === "select" ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(proto, "value");
    if (descriptor && descriptor.set) descriptor.set.call(el, value);
    else el.value = value;
  };
  const announce = (el) => {
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  };

  const act = (nonce, action) => {
    const el = marked(String(nonce));
    if (!el) return JSON.stringify({ ok: false, reason: "gone" });
    const words = wordsOf(el);
    const secret = isPrivate(el, words.name, words.label);
    if (action.do === "focus") {
      if (el.scrollIntoView) { try { el.scrollIntoView({ block: "center", inline: "nearest" }); } catch (error) {} }
      el.focus();
      const scope = el.getRootNode ? el.getRootNode() : document;
      if ((scope.activeElement || document.activeElement) !== el) return JSON.stringify({ ok: false, reason: "unfocused" });
      if (isTextField(el) && typeof el.select === "function") { try { el.select(); } catch (error) {} }
      else if (el.isContentEditable === true && typeof getSelection === "function") { try { getSelection().selectAllChildren(el); } catch (error) {} }
      return JSON.stringify({ ok: true, typed: isTextField(el) && !["date", "time", "datetime-local", "month", "week", "color"].includes(typeOf(el)) });
    }
    if (action.do === "read") {
      if (secret) return JSON.stringify({ ok: true, sensitive: true });
      return JSON.stringify({ ok: true, value: valueOf(el), checked: el.checked === true });
    }
    if (secret) return JSON.stringify({ ok: false, reason: "private" });
    if (action.do === "set") {
      if (el.isContentEditable === true && !isControl(el)) el.textContent = String(action.value);
      else setValue(el, String(action.value));
      announce(el);
      return JSON.stringify({ ok: true });
    }
    if (action.do === "select") {
      const option = optionOf(el, String(action.value));
      if (!option) return JSON.stringify({ ok: false, reason: "option" });
      option.selected = true;
      announce(el);
      return JSON.stringify({ ok: true, value: clean(option.label || option.textContent) });
    }
    return JSON.stringify({ ok: false, reason: "action" });
  };

  function unmark(nonce) {
    for (const el of document.querySelectorAll("[" + MARK + '="' + String(nonce) + '"]')) el.removeAttribute(MARK);
    return "ok";
  }

  const state = () => JSON.stringify({
    url: location.href,
    title: clean(document.title),
    ready: document.readyState !== "loading" && Date.now() - leavingAt > LEAVING_MS,
    passwordField: Array.from(document.querySelectorAll('input[type="password"]')).some((el) => visible(el) && !el.disabled && !el.readOnly),
  });

  const drain = (id) => {
    listen(id);
    if (location.href !== lastUrl) push("open", null);
    lastUrl = location.href;
    const events = queue.splice(0, DRAIN_MAX);
    return JSON.stringify({ installed: true, url: location.href, title: clean(document.title), events, more: queue.length > 0 });
  };

  const answerTo = (request) => {
    if (!request || typeof request !== "object") return JSON.stringify({ error: "request" });
    if (request.do === "ping") return JSON.stringify({ ok: true });
    if (request.do === "drain") return drain(request.take);
    if (request.do === "forget") return forget();
    if (request.do === "state") return state();
    if (request.do === "find") return find(request.target || {}, request.options || {});
    if (request.do === "act") return act(request.nonce, request.action || {});
    if (request.do === "unmark") return JSON.stringify(unmark(request.nonce));
    return JSON.stringify({ error: "request" });
  };
  document.addEventListener(CALL_EVENT, () => {
    const asked = collect(CALL_IN);
    if (asked === null) return;
    let answer;
    try { answer = answerTo(JSON.parse(asked)); } catch (error) { answer = JSON.stringify({ error: "failed" }); }
    leave(CALL_OUT, answer);
  });
  Object.defineProperty(window, GLOBAL, { value: true, enumerable: false, configurable: true });
  return "installed";
})()`;

const TEMPLATE = SOURCE
  .replaceAll("SENSITIVE_SOURCE", JSON.stringify(SENSITIVE_FIELD_PATTERN.source))
  .replaceAll("SENSITIVE_FLAGS", JSON.stringify(SENSITIVE_FIELD_PATTERN.flags))
  .replaceAll("GLOBAL", JSON.stringify(GLOBAL))
  .replaceAll("CALL_EVENT", JSON.stringify(CALL_EVENT))
  .replaceAll("CALL_IN", JSON.stringify(CALL_IN))
  .replaceAll("CALL_OUT", JSON.stringify(CALL_OUT))
  .replaceAll("STASH", JSON.stringify(STASH))
  .replaceAll("MAX_QUEUE", String(MAX_QUEUE))
  .replaceAll("DRAIN_MAX", String(DRAIN_MAX))
  .replaceAll("LEAVING_MS", String(LEAVING_MS))
  .replaceAll("TEXT_MAX", String(DEMO_TEXT_MAX))
  .replaceAll("VALUE_MAX", String(DEMO_VALUE_MAX))
  .replaceAll("MARK", JSON.stringify(DEMO_MARK));

const takeId = (take: string) => (/^[\w-]{1,64}$/u.test(take) ? take : "");

/** Puts the recorder in a document, once, to find and act on elements. It keeps nothing of what happens there until a
 * recording reads it with `demoDrainExpression`. Evaluating it again changes nothing. */
export const DEMO_LOCATE_SCRIPT = TEMPLATE.replaceAll("INITIAL_TAKE", '""');

/** The same script recording for `take` from the moment it runs: for the documents a recording moves through. */
export function demoRecordingScript(take: string): string {
  return TEMPLATE.replaceAll("INITIAL_TAKE", JSON.stringify(takeId(take)));
}

/** One request to the document's recorder, from whatever script world the expression runs in; `absent` where a
 * document has none. The answer is the recorder's own JSON text. */
function call(request: Record<string, unknown>, absent: string): string {
  return `(() => {
  const IN = ${JSON.stringify(CALL_IN)}, OUT = ${JSON.stringify(CALL_OUT)};
  const attribute = (key) => "data-" + key.replace(/_/g, "-");
  const root = document.documentElement;
  let stored = false;
  try { sessionStorage.setItem(IN, ${JSON.stringify(JSON.stringify(request))}); stored = true; } catch (error) {}
  if (!stored) { if (!root) return ${absent}; root.setAttribute(attribute(IN), ${JSON.stringify(JSON.stringify(request))}); }
  document.dispatchEvent(new Event(${JSON.stringify(CALL_EVENT)}));
  let answer = null;
  try { answer = sessionStorage.getItem(OUT); if (answer !== null) sessionStorage.removeItem(OUT); sessionStorage.removeItem(IN); } catch (error) {}
  if (root) {
    if (answer === null && root.hasAttribute(attribute(OUT))) answer = root.getAttribute(attribute(OUT));
    root.removeAttribute(attribute(OUT));
    root.removeAttribute(attribute(IN));
  }
  return answer === null ? ${absent} : answer;
})()`;
}

/** Answers a `DemoDrain` as JSON: what the person did since the last read of the recording `take`. A document that was
 * not recording for `take` starts now, with nothing from before. `installed` is false where the script is absent. */
export function demoDrainExpression(take: string): string {
  return call({ do: "drain", take: takeId(take) }, `JSON.stringify({ installed: false, url: location.href, title: document.title, events: [] })`);
}

/** Ends the recording in this document: the script keeps nothing from then on, and drops what it had not handed over. */
export function demoForgetExpression(): string {
  return call({ do: "forget" }, JSON.stringify(JSON.stringify({ ok: false })));
}

/** What `demoFindExpression` answers, as JSON. */
export interface DemoFound {
  /** How many elements the words name: the step acts only when it is exactly one. */
  count: number;
  /** The CSS selector of the one element found, good until `demoUnmarkExpression`. */
  selector?: string;
  tag?: string;
  inputType?: string;
  disabled?: boolean;
  checked?: boolean;
  /** The page keeps this field private: nothing is typed into it but a saved login. */
  sensitive?: boolean;
  /** For a list or a group of options: whether the wanted option is there. */
  option?: boolean;
  /** The recorder is not in this document yet. */
  absent?: boolean;
}

/** Finds the one element a step's target names and marks it with `nonce`. */
export function demoFindExpression(target: DemoTarget, options: { kind: DemoStepKind; nonce: string; value?: string }): string {
  const words: DemoTarget = { role: target.role, name: target.name, ...(target.label ? { label: target.label } : {}), ...(target.within ? { within: target.within } : {}),
    ...(target.placeholder ? { placeholder: target.placeholder } : {}), ...(target.testId ? { testId: target.testId } : {}) };
  return call({ do: "find", target: words, options: { kind: options.kind, nonce: options.nonce, ...(options.value === undefined ? {} : { value: options.value }) } }, JSON.stringify(JSON.stringify({ count: 0, absent: true })));
}

export type DemoPageAction =
  | { do: "focus" }
  | { do: "set"; value: string }
  | { do: "select"; value: string }
  | { do: "read" };

/** Acts on the element `nonce` marks, in the page: focus and select a field, set a value typing cannot, choose an option, read back. */
export function demoActExpression(nonce: string, action: DemoPageAction): string {
  return call({ do: "act", nonce, action }, JSON.stringify(JSON.stringify({ ok: false, reason: "absent" })));
}

/** Takes the marks of `nonce` off the page. */
export function demoUnmarkExpression(nonce: string): string {
  return call({ do: "unmark", nonce }, JSON.stringify(JSON.stringify("absent")));
}

/** What `demoPageStateExpression` answers, as JSON. */
export interface DemoPageState {
  url: string;
  title: string;
  /** The document's elements are there to act on. */
  ready: boolean;
  /** A password box a person could type into is showing. */
  passwordField: boolean;
  /** The recorder is not in this document yet. */
  absent?: boolean;
}

export function demoPageStateExpression(): string {
  return call({ do: "state" }, `JSON.stringify({ url: location.href, title: document.title, ready: document.readyState !== "loading", passwordField: false, absent: true })`);
}
