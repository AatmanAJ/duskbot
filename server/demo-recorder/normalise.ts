// What the person meant, from what the page saw: one step per thing done. Typing becomes what the field held last,
// a list keeps its last choice, a ticked-then-cleared box is nothing, and clicks that did nothing, scrolling, the Tab
// key and focus moving about are dropped. A sign-in becomes one step that names the Vault and holds no text at all.
import { DEMO_MAX_STEPS, type DemoStep, type DemoTarget } from "../../shared/demo-recording.ts";
import { demoUrl, sanitiseDemoEvent, type RawDemoEvent, type RawDemoTarget } from "./events.ts";

/** A second page this soon after the first, with nothing done in between, is the site redirecting. */
const REDIRECT_MS = 3_000;
/** A page that opens this soon after something was done on the one before was opened by it. */
const CAUSED_MS = 1_500;
const DOUBLE_CLICK_MS = 500;

interface Draft {
  step: DemoStep;
  /** What tells this step's element from every other: same key, same field. */
  key: string;
  /** A fill that has held text at some point. */
  sawText?: boolean;
  /** A checkbox as it was before the person touched it. */
  wasChecked?: boolean;
  /** A sign-in still taking the rest of its form: the document and form it belongs to. */
  signIn?: { url: string; form: number; open: boolean };
  at: number;
}

/** Steps after which a field may have a different meaning: nothing is merged across one. */
const BARRIERS = new Set<DemoStep["kind"]>(["open", "click", "press", "sign-in", "protected"]);

function wire(target: RawDemoTarget): DemoTarget {
  return {
    role: target.role,
    name: target.name,
    ...(target.label ? { label: target.label } : {}),
    ...(target.within ? { within: target.within } : {}),
    ...(target.placeholder ? { placeholder: target.placeholder } : {}),
    ...(target.testId ? { testId: target.testId } : {}),
  };
}

function documentOf(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return url;
  }
}

const keyOf = (target: RawDemoTarget, url: string) =>
  [documentOf(url), target.form ?? 0, target.role, target.name, target.label ?? "", target.within ?? "", target.placeholder ?? "", target.testId ?? ""].join("\n");

function hostOf(url: string): string {
  try { return new URL(url).hostname; } catch { return ""; }
}

const NATIVE_STATEFUL = new Set(["checkbox", "radio", "combobox", "listbox", "option", "file"]);
const nativeControl = (target: RawDemoTarget) => ["input", "select", "option", "textarea"].includes(target.tag);

export function normaliseDemo(events: readonly RawDemoEvent[]): DemoStep[] {
  const drafts: Draft[] = [];
  let lastOpenAt: number | null = null;
  /** The last thing done on the current page that could have opened the next one. */
  let acted: { type: RawDemoEvent["type"]; key?: string; at: number } | null = null;

  const full = () => drafts.length >= DEMO_MAX_STEPS;
  const add = (index: number, event: RawDemoEvent, step: Omit<DemoStep, "id">, key: string, extra: Partial<Draft> = {}): Draft | null => {
    if (full()) return null;
    const draft: Draft = { step: { id: `s${index}`, ...step }, key, at: event.at, ...extra };
    drafts.push(draft);
    return draft;
  };
  /** The step of this kind for this element since the last barrier, so coming back to a field edits its step. */
  const since = (kind: DemoStep["kind"], key: string): Draft | null => {
    for (let at = drafts.length - 1; at >= 0; at--) {
      const draft = drafts[at]!;
      if (draft.step.kind === kind && draft.key === key) return draft;
      if (BARRIERS.has(draft.step.kind)) return null;
    }
    return null;
  };
  const signingIn = (event: RawDemoEvent, target: RawDemoTarget | undefined): Draft | null => {
    const last = drafts.at(-1);
    if (!last?.signIn?.open || last.signIn.url !== documentOf(event.url)) return null;
    return last.signIn.form === 0 || (target?.form ?? 0) === last.signIn.form ? last : null;
  };

  events.forEach((raw, index) => {
    const event = sanitiseDemoEvent(raw);
    if (!event) return;
    const target = event.target;

    if (event.type === "focus" || event.type === "blur" || event.type === "scroll") return;

    if (event.type === "open") {
      const url = demoUrl(event.url);
      if (!url) return;
      const first = lastOpenAt === null;
      const sinceOpen = lastOpenAt === null ? Infinity : event.at - lastOpenAt;
      lastOpenAt = event.at;
      if (first || !drafts.length) {
        add(index, event, { kind: "open", url }, url);
      } else if (acted) {
        const caused = acted.type === "click" || acted.type === "submit" || (acted.type === "key" && acted.key === "Enter") || event.at - acted.at < CAUSED_MS;
        if (!caused) add(index, event, { kind: "open", url }, url);
      } else if (sinceOpen >= REDIRECT_MS) {
        const last = drafts.at(-1)!;
        if (last.step.kind === "open") drafts[drafts.length - 1] = { step: { id: `s${index}`, kind: "open", url }, key: url, at: event.at };
        else add(index, event, { kind: "open", url }, url);
      }
      acted = null;
      return;
    }

    if (event.type === "submit") {
      acted = { type: "submit", at: event.at };
      return;
    }

    if (event.type === "key") {
      if (event.key === "Tab") return;
      acted = { type: "key", key: event.key, at: event.at };
      const login = signingIn(event, target);
      if (login && event.key === "Enter") {
        login.signIn!.open = false;
        return;
      }
      if (!target || target.role === "button" || target.role === "link") return;
      add(index, event, { kind: "press", key: event.key!, target: wire(target) }, keyOf(target, event.url));
      return;
    }

    if (!target) return;
    const key = keyOf(target, event.url);

    if (event.type === "click") {
      if (!target.interactive) return;
      acted = { type: "click", at: event.at };
      if (target.editable) return;
      if (NATIVE_STATEFUL.has(target.role) && nativeControl(target)) return;
      const login = signingIn(event, target);
      if (login) {
        if (target.role === "button" || login.signIn!.form === 0) login.signIn!.open = false;
        return;
      }
      const last = drafts.at(-1);
      if (last?.step.kind === "click" && last.key === key && event.at - last.at < DOUBLE_CLICK_MS) {
        last.at = event.at;
        return;
      }
      add(index, event, { kind: "click", target: wire(target) }, key);
      return;
    }

    // input and change
    acted = { type: event.type, at: event.at };
    if (target.sensitive) {
      const login = signingIn(event, target);
      if (login) return;
      if (target.inputType !== "password") {
        if (!since("protected", key)) add(index, event, { kind: "protected", target: wire(target) }, key);
        return;
      }
      const form = target.form ?? 0;
      const document = documentOf(event.url);
      // What was typed beside the password belongs to the saved login, not to the skill.
      while (drafts.length) {
        const before = drafts.at(-1)!;
        const sameForm = before.key.startsWith(`${document}\n${form}\n`);
        if (!sameForm || !["fill", "check", "select", "choose"].includes(before.step.kind)) break;
        drafts.pop();
      }
      add(index, event, { kind: "sign-in", site: hostOf(event.url) }, `${document}\n${form}\nsign-in`, { signIn: { url: document, form, open: true } });
      return;
    }
    if (signingIn(event, target)) return;

    if (target.role === "file") {
      const file = event.files?.[0];
      if (!file) return;
      const known = since("upload", key);
      if (known) known.step.value = file;
      else add(index, event, { kind: "upload", target: wire(target), value: file }, key);
      return;
    }

    if (target.role === "checkbox" || target.role === "switch") {
      if (event.type !== "change" || typeof event.checked !== "boolean") return;
      const known = since("check", key);
      if (known) known.step.checked = event.checked;
      else add(index, event, { kind: "check", target: wire(target), checked: event.checked }, key, { wasChecked: !event.checked });
      return;
    }

    if (target.role === "radio") {
      if (event.type !== "change" || event.checked !== true) return;
      if (!target.within) {
        add(index, event, { kind: "click", target: wire(target) }, key);
        return;
      }
      const group: DemoTarget = { role: "radiogroup", name: target.within };
      const groupKey = [documentOf(event.url), target.form ?? 0, "radiogroup", target.within].join("\n");
      const known = since("choose", groupKey);
      if (known) known.step.value = target.name;
      else add(index, event, { kind: "choose", target: group, value: target.name }, groupKey);
      return;
    }

    if (target.role === "combobox" || target.role === "listbox") {
      if (event.type !== "change" || typeof event.option !== "string") return;
      const known = since("select", key);
      if (known) known.step.value = event.option;
      else add(index, event, { kind: "select", target: wire(target), value: event.option }, key);
      return;
    }

    if (!target.editable || typeof event.value !== "string") return;
    const known = since("fill", key);
    if (known) {
      known.step.value = event.value;
      known.sawText ||= event.value !== "";
    } else {
      add(index, event, { kind: "fill", target: wire(target), value: event.value }, key, { sawText: event.value !== "" });
    }
  });

  return drafts
    .filter((draft) => !(draft.step.kind === "fill" && draft.step.value === "" && draft.sawText))
    .filter((draft) => !(draft.step.kind === "check" && draft.step.checked === draft.wasChecked))
    .map((draft) => draft.step);
}
