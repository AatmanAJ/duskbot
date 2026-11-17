import type { DemoPoint, DemoRect, DemoTarget } from "../../../shared/demo-recording.ts";
import { isSensitiveInput } from "../../browser/cdp/sensitive.ts";
import type { AccessibilityProbe, RawInput } from "../capture.ts";
import type { ScreenFrame } from "../frames.ts";
import type { Observation, ReplaySurface } from "../replay.ts";
import { SECURE_VALUE } from "./dom.ts";

/**
 * A desktop's computer driver, its tools by name, and the screen as a picture. The tools and their arguments are
 * those of Cua Driver 0.28.2 on macOS and 0.47.24 in the bots' own desktop. The driver reads macOS AX, Windows UI
 * Automation and Linux AT-SPI behind the same tools, so what follows never asks which system it is on.
 */
export interface DesktopTools {
  call(tool: string, args: Record<string, unknown>): Promise<unknown>;
  frame(): Promise<ScreenFrame | null>;
  /** Which shortcut selects everything in a field: Command on a Mac, Control elsewhere. */
  readonly mac?: boolean;
}

interface OsElement {
  role: string;
  name: string;
  value: string;
  token: string;
  secure: boolean;
  /** In the screen's own pixels. */
  bounds?: DemoRect;
}

interface Look {
  pid: number;
  windowId: number;
  title: string;
  app: string;
  elements: OsElement[];
  at: number;
}

const LOOK_MS = 400;
const TREE_TIMEOUT_MS = 8_000;
const MAX_ELEMENTS = 1_200;
const NAME_LIMIT = 300;
const TEXT_ROLES = new Set(["heading", "alert", "status", "notification", "dialog"]);
const FIELD_ROLES = new Set(["textbox", "combobox", "checkbox", "radio", "slider", "spinbutton", "searchbox", "switch"]);

/** One name for a control on every system: the driver passes on AX, UI Automation and AT-SPI role names as they are. */
const ROLES: Readonly<Record<string, string>> = {
  button: "button", pushbutton: "button", menubutton: "button", togglebutton: "button", splitbutton: "button",
  textfield: "textbox", entry: "textbox", edit: "textbox", text: "textbox", textarea: "textbox", passwordtext: "textbox", securetextfield: "textbox",
  searchfield: "searchbox",
  popupbutton: "combobox", combobox: "combobox", dropdown: "combobox",
  checkbox: "checkbox", radiobutton: "radio", switch: "switch", slider: "slider", incrementor: "spinbutton", spinbutton: "spinbutton", spinner: "spinbutton",
  link: "link", hyperlink: "link",
  menuitem: "menuitem", tab: "tab", pagetab: "tab", tabitem: "tab", listitem: "listitem", row: "row", cell: "cell",
  heading: "heading", alert: "alert", statusbar: "status", status: "status", notification: "notification", dialog: "dialog", sheet: "dialog", window: "window",
  statictext: "text", label: "text", image: "img",
};

const record = (value: unknown): Record<string, unknown> | null => (value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null);
const words = (value: unknown, limit = NAME_LIMIT) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, limit) : "");
const finite = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const squash = (text: string) => text.replace(/\s+/g, " ").trim().toLowerCase();

/** A role as this module names it, and whether the system's own name says the field is a secure one. */
function roleOf(raw: string): { role: string; secure: boolean } {
  const key = raw.replace(/^AX/, "").replace(/[^A-Za-z]/g, "").toLowerCase();
  return { role: ROLES[key] ?? (squash(raw.replace(/^AX/, "").replace(/([a-z])([A-Z])/g, "$1 $2")) || "element"), secure: /secure|password/i.test(raw) };
}

function rectOf(value: unknown): DemoRect | null {
  const frame = record(value);
  if (!frame) return null;
  const x = finite(frame.x);
  const y = finite(frame.y);
  const width = finite(frame.w) ?? finite(frame.width);
  const height = finite(frame.h) ?? finite(frame.height);
  return x === null || y === null || width === null || height === null || width <= 0 || height <= 0 ? null : { x, y, width, height };
}

/** The driver answers with its structured content, or wraps it as an MCP result does. */
function body(answer: unknown): Record<string, unknown> {
  const outer = record(answer) ?? {};
  return record(outer.structuredContent) ?? outer;
}

function refusal(answer: unknown): string | null {
  const result = body(answer);
  const refused = result.status === "refused" || result.effect === "refused" || result.isError === true || typeof result.error === "string";
  return refused ? words(result.error ?? result.reason ?? result.message, 200) || "The computer refused that." : null;
}

/** The front window and what accessibility says is in it. Throws when the desktop cannot be read. */
async function look(tools: DesktopTools, now: () => number): Promise<Look> {
  const listed = body(await tools.call("list_windows", { on_screen_only: true }));
  const windows = (Array.isArray(listed.windows) ? listed.windows : []).map(record).filter((window): window is Record<string, unknown> => window !== null && finite(window.pid) !== null && finite(window.window_id) !== null);
  if (!windows.length) throw new Error("No window is open on this computer.");
  const front = [...windows].sort((a, b) => (finite(b.z_index) ?? -Infinity) - (finite(a.z_index) ?? -Infinity))[0]!;
  const origin = rectOf(front.bounds);
  const state = body(await tools.call("get_window_state", { pid: front.pid, window_id: front.window_id, include_screenshot: false, max_elements: MAX_ELEMENTS, timeout_ms: TREE_TIMEOUT_MS }));
  const rows = (Array.isArray(state.elements) ? state.elements : []).map(record).filter((row): row is Record<string, unknown> => row !== null);
  const frames = rows.map((row) => rectOf(row.frame));
  // Security: nothing here places a secure field by its box, so a wrong guess about the frames' origin cannot unmask one.
  const local = origin !== null && frames.every((frame) => frame === null || (frame.x + frame.width <= origin.width + 1 && frame.y + frame.height <= origin.height + 1));
  const elements = rows.map((row, index): OsElement => {
    const { role, secure } = roleOf(words(row.role, 80));
    const name = words(row.label) || words(row.title) || words(row.name);
    const frame = frames[index];
    return {
      role,
      name,
      value: words(row.value, 500),
      token: words(row.element_token, 200),
      secure: secure || ((role === "textbox" || role === "searchbox") && isSensitiveInput("", [name])),
      ...(frame ? { bounds: local && origin ? { ...frame, x: frame.x + origin.x, y: frame.y + origin.y } : frame } : {}),
    };
  });
  return { pid: front.pid as number, windowId: front.window_id as number, title: words(state.window_title) || words(front.title), app: words(state.app_name) || words(front.app_name), elements, at: now() };
}

const targetOf = (element: OsElement): DemoTarget => ({ role: element.role, name: element.name, secure: element.secure, ...(element.bounds ? { bounds: element.bounds } : {}) });
const holds = (rect: DemoRect, point: DemoPoint) => point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= rect.y && point.y <= rect.y + rect.height;

/**
 * What a desktop's accessibility says while a person shows a task on it. The driver does not say which element has the
 * keyboard, so focus is taken to be what the person last clicked, until a key that can move it: `note` hears each input.
 * Security: a picture is refused whole while any secure field is on the screen, since its box cannot be trusted here.
 */
export function createOsProbe(tools: DesktopTools, options: { now?: () => number } = {}): AccessibilityProbe & { note(raw: RawInput): void } {
  const now = options.now ?? Date.now;
  let last: Look | null = null;
  let pending: Promise<Look> | null = null;
  let clicked: DemoPoint | null = null;
  const seen = (): Promise<Look> => {
    if (last && now() - last.at < LOOK_MS) return Promise.resolve(last);
    pending ??= look(tools, now).then((next) => { last = next; return next; }).finally(() => { pending = null; });
    return pending;
  };
  const under = async (point: DemoPoint): Promise<DemoTarget | null> => {
    const hit = (await seen()).elements.filter((element) => element.bounds && holds(element.bounds, point) && (element.name || FIELD_ROLES.has(element.role) || element.role === "button"))
      .sort((a, b) => a.bounds!.width * a.bounds!.height - b.bounds!.width * b.bounds!.height)[0];
    return hit ? targetOf(hit) : null;
  };
  return {
    kind: "os",
    note(raw) {
      if (raw.type === "pointer" && raw.action === "down") {
        clicked = { x: raw.x, y: raw.y };
        last = null;
      } else if (raw.type === "key" && raw.action === "down" && !raw.text && [...raw.key].length !== 1) clicked = null;
      else if (raw.type === "open" || raw.type === "choose") clicked = null;
    },
    at: under,
    focused: async () => (clicked ? under(clicked) : null),
    async secureRegions() {
      const current = await seen().catch(() => null);
      if (!current || current.elements.some((element) => element.secure)) return null;
      return [];
    },
    async context() {
      const current = await seen();
      return { title: current.title, app: current.app };
    },
    async texts() {
      const current = await seen();
      const found = [current.title, ...current.elements.filter((element) => TEXT_ROLES.has(element.role) && element.name).map((element) => element.name)].filter(Boolean);
      return [...new Set(found)].slice(0, 40);
    },
  };
}

/** The driver's names for the keys a plan presses; its own names are lowercase. */
const KEYS: Readonly<Record<string, string>> = {
  enter: "return", backspace: "delete", arrowup: "up", arrowdown: "down", arrowleft: "left", arrowright: "right", " ": "space",
};
const MODIFIERS: Readonly<Record<string, string>> = { control: "ctrl", ctrl: "ctrl", meta: "cmd", cmd: "cmd", alt: "alt", shift: "shift" };

/** A desktop a plan is carried out on, by what accessibility names: the driver's element actions, never a position. */
export function createOsSurface(tools: DesktopTools, options: { now?: () => number } = {}): ReplaySurface {
  const now = options.now ?? Date.now;
  const fresh = () => look(tools, now);
  const find = (current: Look, role: string, name: string): OsElement | string => {
    const matches = current.elements.filter((element) => element.role === role && squash(element.name) === squash(name) && element.token);
    if (matches.length === 1) return matches[0]!;
    return matches.length > 1 ? `More than one thing in this window is the ${role} "${name}".` : `Could not find the ${role} "${name}" in the window "${current.title || current.app}".`;
  };
  const act = async (tool: string, args: Record<string, unknown>): Promise<{ ok: true } | { ok: false; reason: string }> => {
    const refused = refusal(await tools.call(tool, args));
    return refused ? { ok: false, reason: refused } : { ok: true };
  };
  return {
    accessibility: "os",
    async perform(action, options) {
      try {
        if (action.do === "open") return { ok: false, reason: "An address cannot be opened on this computer by name; the bot has to open it." };
        const current = await fresh();
        const window = { pid: current.pid, window_id: current.windowId, delivery_mode: "foreground" };
        if (action.do === "press") {
          const parts = action.key.split("+").map((part) => part.trim()).filter(Boolean);
          const key = parts.pop() ?? "";
          const named = KEYS[key.toLowerCase()] ?? key.toLowerCase();
          const held = parts.map((part) => MODIFIERS[part.toLowerCase()]).filter((part): part is string => part !== undefined);
          return held.length ? act("hotkey", { ...window, keys: [...held, named] }) : act("press_key", { ...window, key: named });
        }
        const element = find(current, action.role, action.name);
        if (typeof element === "string") return { ok: false, reason: element };
        const target = { ...window, element_token: element.token };
        if (action.do === "click") return act("click", target);
        if (action.do === "choose") return act("set_value", { pid: current.pid, window_id: current.windowId, element_token: element.token, value: action.value });
        // Security: a tool's arguments can be read from the process list, so a saved secret is never typed this way.
        if (options?.secret || element.secure) return { ok: false, reason: `The ${element.role} "${element.name}" takes a secret, which only the bot's own sign-in tool may fill.` };
        const focused = await act("click", target);
        if (!focused.ok) return focused;
        const cleared = await act("hotkey", { ...target, keys: [tools.mac ? "cmd" : "ctrl", "a"] });
        if (!cleared.ok) return cleared;
        return action.value.length ? act("type_text", { ...target, text: action.value }) : act("press_key", { ...target, key: "delete" });
      } catch (error) {
        return { ok: false, reason: error instanceof Error && error.message ? error.message.slice(0, 300) : "The computer could not be reached." };
      }
    },
    async observe(): Promise<Observation> {
      const current = await fresh();
      return {
        title: current.title,
        url: "",
        texts: [...new Set([current.title, ...current.elements.filter((element) => TEXT_ROLES.has(element.role) && element.name).map((element) => element.name)].filter(Boolean))].slice(0, 40),
        fields: current.elements.filter((element) => FIELD_ROLES.has(element.role) && element.name).slice(0, 200)
          .map((element) => ({ role: element.role, name: element.name, value: element.secure ? (element.value ? SECURE_VALUE : "") : element.value })),
      };
    },
  };
}
