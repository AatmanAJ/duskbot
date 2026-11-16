// A stand-in for a bot's browser on a real site: happy-dom pages fetched over HTTP, with cookies, links and forms that
// navigate, and a person whose clicks and typing reach the page as a browser delivers them. It answers the same reads
// and typing fill_login uses (`loginInput`), so the recorder and the replayer run here through the port they use on
// every engine. It keeps every expression it was asked to evaluate and every text it was asked to type.
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { Window } from "happy-dom";

import { demoPortOf, type DemoPagePort, type LoginInput } from "../ports.ts";

type El = {
  tagName: string;
  type?: string;
  name?: string;
  value: string;
  checked?: boolean;
  disabled?: boolean;
  form?: El | null;
  href?: string;
  files?: unknown;
  selectionStart?: number | null;
  selectionEnd?: number | null;
  focus(): void;
  blur(): void;
  closest(selector: string): El | null;
  getAttribute(name: string): string | null;
  querySelectorAll(selector: string): ArrayLike<El>;
  dispatchEvent(event: unknown): boolean;
  setSelectionRange?(start: number, end: number): void;
  elements?: ArrayLike<El>;
  options?: ArrayLike<{ value: string; textContent: string | null; selected: boolean }>;
  selectedIndex?: number;
  textContent: string | null;
};

interface Pending {
  method: "GET" | "POST";
  url: string;
  form?: El;
  submitter?: El | null;
}

export interface FakeBrowserOptions {
  /** Whether this browser can run a script in every new document before the page's own, as the CDP driver can. */
  scriptsOnNewDocuments?: boolean;
}

export class FakeBrowser {
  window: Window;
  /** Every expression the page was asked to evaluate. */
  readonly evaluated: string[] = [];
  /** Every text typed through `insertText`. */
  readonly typed: string[] = [];
  /** Every address a document was loaded from, redirects included. */
  readonly visited: string[] = [];
  readonly #cookies = new Map<string, string>();
  readonly #uploads = new Map<El, string[]>();
  readonly #documentScripts = new Set<string>();
  readonly #options: FakeBrowserOptions;
  #pending: Pending | null = null;
  #dirty: El | null = null;

  constructor(options: FakeBrowserOptions = {}) {
    this.#options = options;
    this.window = this.#document("about:blank", "", null);
  }

  get url(): string {
    return this.window.location.href;
  }

  get document() {
    return this.window.document;
  }

  text(): string {
    return (this.window.document.body.textContent ?? "").replace(/\s+/gu, " ").trim();
  }

  #document(url: string, html: string, from: Window | null): Window {
    const window = new Window({ url, settings: { disableJavaScriptEvaluation: false } });
    if (from && from.location.origin === window.location.origin) {
      for (let at = 0; at < from.sessionStorage.length; at++) {
        const key = from.sessionStorage.key(at)!;
        window.sessionStorage.setItem(key, from.sessionStorage.getItem(key) ?? "");
      }
    }
    const body = /<body[^>]*>([\s\S]*)<\/body>/iu.exec(html)?.[1] ?? html;
    window.document.title = /<title>([\s\S]*?)<\/title>/iu.exec(html)?.[1]?.replace(/&amp;/gu, "&") ?? "";
    window.document.body.innerHTML = body;
    // After the page's own handlers: what a browser would do next (follow the link, send the form) happens here.
    window.addEventListener("click", (event) => {
      const link = (event.target as unknown as El).closest?.("a[href]");
      if (!link) return;
      if (!event.defaultPrevented) this.#pending = { method: "GET", url: new URL(link.getAttribute("href")!, window.location.href).href };
      event.preventDefault();
    });
    window.addEventListener("submit", (event) => {
      const form = event.target as unknown as El;
      if (!event.defaultPrevented) {
        const method = (form.getAttribute("method") ?? "get").toUpperCase() === "POST" ? "POST" : "GET";
        this.#pending = { method, url: new URL(form.getAttribute("action") ?? "", window.location.href).href, form, submitter: (event as unknown as { submitter?: El | null }).submitter ?? null };
      }
      event.preventDefault();
    });
    for (const script of this.#documentScripts) window.eval(script);
    return window;
  }

  async #load(method: "GET" | "POST", url: string, body?: FormData | URLSearchParams): Promise<void> {
    let next: { method: "GET" | "POST"; url: string; body?: FormData | URLSearchParams } | null = { method, url, body };
    for (let hop = 0; next && hop < 10; hop++) {
      const cookie = [...this.#cookies].map(([name, value]) => `${name}=${value}`).join("; ");
      const response: Response = await fetch(next.url, { method: next.method, body: next.body, redirect: "manual", headers: cookie ? { cookie } : {} });
      for (const line of response.headers.getSetCookie()) {
        const [pair, ...attributes] = line.split(";");
        const at = pair!.indexOf("=");
        const name = pair!.slice(0, at).trim();
        if (attributes.some((attribute) => /^\s*max-age=0/iu.test(attribute))) this.#cookies.delete(name);
        else this.#cookies.set(name, pair!.slice(at + 1).trim());
      }
      this.visited.push(next.url);
      const location = response.headers.get("location");
      if (response.status >= 300 && response.status < 400 && location) {
        await response.arrayBuffer();
        next = { method: "GET", url: new URL(location, next.url).href };
        continue;
      }
      const html = await response.text();
      const old = this.window;
      old.dispatchEvent(new old.Event("pagehide"));
      this.window = this.#document(next.url, html, old);
      this.#dirty = null;
      void old.happyDOM.close();
      next = null;
    }
  }

  /** The address bar: goes to `url`. */
  async goto(url: string): Promise<void> {
    await this.#load("GET", url);
  }

  #formBody(form: El, submitter: El | null | undefined): FormData {
    const data = new FormData();
    for (const field of Array.from(form.elements ?? [])) {
      const tag = field.tagName;
      if (!field.name || field.disabled) continue;
      if (tag === "INPUT" && field.type === "file") {
        const paths = this.#uploads.get(field) ?? [];
        if (paths.length) for (const path of paths) data.append(field.name, new Blob([readFileSync(path)]), basename(path));
        else data.append(field.name, new Blob([]), "");
      } else if (tag === "INPUT" && (field.type === "checkbox" || field.type === "radio")) {
        if (field.checked) data.append(field.name, field.value);
      } else if (tag === "INPUT" && (field.type === "submit" || field.type === "button" || field.type === "image")) {
        if (field === submitter) data.append(field.name, field.value);
      } else if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") {
        data.append(field.name, field.value);
      }
    }
    return data;
  }

  /** Does what the page asked of the browser: follows the clicked link or sends the form. */
  async #settle(): Promise<void> {
    const pending = this.#pending;
    this.#pending = null;
    if (!pending) return;
    if (!pending.form) return this.#load("GET", pending.url);
    const data = this.#formBody(pending.form, pending.submitter);
    if (pending.method === "POST") {
      const multipart = (pending.form.getAttribute("enctype") ?? "").toLowerCase() === "multipart/form-data";
      const body = multipart ? data : new URLSearchParams([...data].filter((entry): entry is [string, string] => typeof entry[1] === "string"));
      return this.#load("POST", pending.url, body);
    }
    const target = new URL(pending.url);
    target.search = new URLSearchParams([...data].filter((entry): entry is [string, string] => typeof entry[1] === "string")).toString();
    return this.#load("GET", target.href);
  }

  #one(selector: string): El {
    const found = this.window.document.querySelectorAll(selector) as unknown as ArrayLike<El>;
    if (found.length !== 1) throw new Error(`${selector} names ${found.length} elements on ${this.url}`);
    return found[0]!;
  }

  /** A field the person typed in tells the page once they leave it. */
  #leave(next: El | null): void {
    const dirty = this.#dirty;
    if (!dirty || dirty === next) return;
    this.#dirty = null;
    dirty.dispatchEvent(new this.window.Event("change", { bubbles: true }));
  }

  #focus(element: El): void {
    const active = this.window.document.activeElement as unknown as El | null;
    if (active === element) return;
    this.#leave(element);
    const focusable = ["INPUT", "SELECT", "TEXTAREA", "BUTTON", "A"].includes(element.tagName);
    if (focusable) element.focus();
    else if (active && active.tagName !== "BODY") active.blur();
  }

  #clickElement(element: El): void {
    const { MouseEvent } = this.window;
    element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    this.#focus(element);
    element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true }));
    element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  }

  #key(key: string): void {
    const { KeyboardEvent } = this.window;
    const target = (this.window.document.activeElement ?? this.window.document.body) as unknown as El;
    target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
    target.dispatchEvent(new KeyboardEvent("keyup", { key, bubbles: true, cancelable: true }));
  }

  #insert(text: string): void {
    const field = this.window.document.activeElement as unknown as El | null;
    if (!field || typeof field.value !== "string" || !["INPUT", "TEXTAREA"].includes(field.tagName)) return;
    const { InputEvent } = this.window;
    const start = typeof field.selectionStart === "number" ? field.selectionStart : field.value.length;
    const end = typeof field.selectionEnd === "number" ? field.selectionEnd : field.value.length;
    field.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, cancelable: true, data: text, inputType: "insertText" }));
    field.value = field.value.slice(0, start) + text + field.value.slice(end);
    field.setSelectionRange?.(start + text.length, start + text.length);
    field.dispatchEvent(new InputEvent("input", { bubbles: true, data: text, inputType: "insertText" }));
    this.#dirty = field;
  }

  #pressKey(key: string): void {
    this.#key(key);
    const field = this.window.document.activeElement as unknown as El | null;
    if (key === "Tab") return this.#leave(null);
    const form = field?.form as (El & { requestSubmit(): void }) | null | undefined;
    if (key !== "Enter" || !field || field.tagName !== "INPUT" || !form) return;
    this.#leave(null);
    form.requestSubmit();
  }

  /** What the person does, as a browser delivers it to the page. */
  readonly person = {
    /** Clicks the one element a CSS selector names. */
    click: async (selector: string): Promise<void> => {
      this.#clickElement(this.#one(selector));
      await this.#settle();
    },
    /** Clicks somewhere that is not a control: the page's background. */
    clickNowhere: async (): Promise<void> => {
      this.#clickElement(this.window.document.body as unknown as El);
      await this.#settle();
    },
    /** Types into a field one key at a time, clicking into it first. */
    type: async (selector: string, text: string): Promise<void> => {
      const field = this.#one(selector);
      if (this.window.document.activeElement as unknown !== field) this.#clickElement(field);
      for (const char of text) {
        this.#key(char);
        this.#insert(char);
      }
    },
    /** Empties a field the way a person does: select everything, then Backspace. */
    clear: async (selector: string): Promise<void> => {
      const field = this.#one(selector);
      if (this.window.document.activeElement as unknown !== field) this.#clickElement(field);
      this.#key("Backspace");
      field.value = "";
      field.dispatchEvent(new this.window.InputEvent("input", { bubbles: true, inputType: "deleteContentBackward" }));
      this.#dirty = field;
    },
    /** Picks an option of a list by the words it shows. */
    select: async (selector: string, label: string): Promise<void> => {
      const list = this.#one(selector);
      this.#clickElement(list);
      const option = Array.from(list.options ?? []).find((candidate) => (candidate.textContent ?? "").trim() === label);
      if (!option) throw new Error(`${selector} has no option ${label}`);
      list.value = option.value;
      list.dispatchEvent(new this.window.Event("input", { bubbles: true }));
      list.dispatchEvent(new this.window.Event("change", { bubbles: true }));
    },
    press: async (key: string): Promise<void> => {
      this.#pressKey(key);
      await this.#settle();
    },
    scroll: async (): Promise<void> => {
      this.window.document.dispatchEvent(new this.window.Event("scroll", { bubbles: true }));
    },
    /** Picks files in a file picker. */
    attach: async (selector: string, paths: readonly string[]): Promise<void> => {
      this.#setFiles(this.#one(selector), paths);
    },
  };

  #setFiles(input: El, paths: readonly string[]): void {
    this.#uploads.set(input, [...paths]);
    const files = paths.map((path) => new this.window.File([readFileSync(path)], basename(path)));
    Object.defineProperty(input, "files", { value: files, configurable: true });
    input.dispatchEvent(new this.window.Event("input", { bubbles: true }));
    input.dispatchEvent(new this.window.Event("change", { bubbles: true }));
  }

  /** The reads and typing fill_login asks of a browser. */
  loginInput(): LoginInput {
    return {
      engine: async (args) => {
        if (args[0] === "get" && args[1] === "url") return { url: this.url };
        if (args[0] === "eval" && typeof args[1] === "string") {
          this.evaluated.push(args[1]);
          const result = this.window.eval(args[1]) as unknown;
          await this.#settle();
          return { result };
        }
        throw new Error(`unexpected engine command: ${args[0]}`);
      },
      insertText: async (text) => {
        this.typed.push(text);
        this.#insert(text);
      },
      press: async (key) => {
        this.#pressKey(key);
        await this.#settle();
      },
      click: async (selector) => {
        this.#clickElement(this.#one(selector));
        await this.#settle();
      },
    };
  }

  /** The page as the recorder and the replayer reach it. */
  port(): DemoPagePort {
    return demoPortOf(this.loginInput(), {
      open: (url) => this.goto(url),
      upload: async (selector, paths) => this.#setFiles(this.#one(selector), paths),
      ...(this.#options.scriptsOnNewDocuments ? {
        everyDocument: async (script: string) => {
          this.#documentScripts.add(script);
          this.evaluated.push(script);
          this.window.eval(script);
          return () => { this.#documentScripts.delete(script); };
        },
      } : {}),
    });
  }

  close(): void {
    void this.window.happyDOM.close();
  }
}
