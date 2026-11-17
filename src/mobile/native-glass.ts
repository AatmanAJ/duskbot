import { useEffect, type RefObject } from "react";
import type { MobilePlatform } from "./platform";

/** A rect in css px from the top left of the screen, which on the phone is the native view's own point space. */
export interface GlassFrame { x: number; y: number; w: number; h: number }

export interface GlassHeader {
  back: GlassFrame;
  title: GlassFrame;
  right: GlassFrame | null;
  name: string;
  live: boolean;
  backLabel: string;
  titleLabel: string;
  rightLabel: string;
}

export type GlassButtonKind = "stop" | "mic" | "micSend" | "send" | "waits" | "followUp" | "discard";
export interface GlassButton { kind: GlassButtonKind; disabled: boolean; label: string }

export interface GlassComposer {
  frame: GlassFrame;
  /** from the composer's bottom to the line it rests on (the home indicator's edge, or the keyboard's top) */
  gap: number;
  plus: boolean;
  plusLabel: string;
  placeholder: string;
  disabled: boolean;
  /** what dictation has heard so far, while it listens; the field is hidden then */
  voice: string | null;
  buttons: GlassButton[];
  returnSends: boolean;
}

export interface GlassState {
  dark: boolean;
  accent: string;
  header: GlassHeader | null;
  composer: GlassComposer | null;
}

export type GlassEvent =
  | { type: "tap"; target: "back" | "title" | "right" | "plus" }
  | { type: "button"; index: number }
  | { type: "text"; text: string }
  | { type: "submit" }
  | { type: "focus"; focused: boolean }
  | { type: "height"; height: number };

/** The phone's native glass chrome (ios/App/App/GlassChromePlugin.swift): it draws the chat header and composer
 * over the web view so the glass bends the transcript under it, and hands taps and typing back to the page. */
export interface GlassBridge {
  update(state: GlassState): void;
  setText(text: string, seq: number): void;
  setAvatar(data: string | null): void;
  focus(): void;
  blur(): void;
  clear(): void;
  onEvent(listener: (event: GlassEvent) => void): () => void;
}

const round = (n: number) => Math.round(n * 2) / 2;

export function frameOf(el: Element): GlassFrame {
  const box = el.getBoundingClientRect();
  return { x: round(box.left), y: round(box.top), w: round(box.width), h: round(box.height) };
}

/** Covered by something drawn over the chat (a sheet, a context menu, a dialog): the topmost element at its centre is outside the chat. */
export function covered(el: Element, chat: Element): boolean {
  const doc = el.ownerDocument;
  const box = el.getBoundingClientRect();
  if (box.width === 0 || box.height === 0) return true;
  const x = box.left + box.width / 2;
  const y = box.top + box.height / 2;
  if (x < 0 || y < 0 || x > doc.documentElement.clientWidth || y > doc.documentElement.clientHeight) return false;
  const hit = doc.elementFromPoint(x, y);
  return Boolean(hit) && !chat.contains(hit);
}

/** Which native control stands in for a button in the composer's actions, or null when it has no native twin. */
export function buttonKind(el: HTMLElement): GlassButtonKind | null {
  if (el.matches("[data-composer-stop]")) return "stop";
  if (el.matches('[data-voice-mic="start"]')) return "mic";
  if (el.matches('[data-voice-mic="send"]')) return "micSend";
  if (el.matches("[data-composer-send]")) return el.dataset.composerSend === "waits" ? "waits" : "send";
  if (el.closest("[data-composer-follow-up]") && el.getAttribute("aria-haspopup")) return "followUp";
  if (el.matches("[data-composer-discard]")) return "discard";
  return null;
}

/** The composer's action buttons in order, each with its native twin; null when one has none (the page keeps its own composer then). */
export function composerButtons(actions: Element | null): { buttons: GlassButton[]; elements: HTMLElement[] } | null {
  // in the order they are drawn, not written: a working bot's Stop sits last with `order`
  const elements = actions ? [...actions.querySelectorAll<HTMLElement>("button")].sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left) : [];
  const buttons: GlassButton[] = [];
  for (const el of elements) {
    const kind = buttonKind(el);
    if (!kind) return null;
    buttons.push({ kind, disabled: (el as HTMLButtonElement).disabled, label: el.getAttribute("aria-label") ?? "" });
  }
  return { buttons, elements };
}

/** A strip inside the pill above its row (a reply, attachments): only the page draws those. */
function hasStrips(shell: Element): boolean {
  const row = shell.querySelector("[data-composer-row]");
  const content = row?.parentElement;
  return Boolean(content && [...content.children].some((child) => child !== row && child.getBoundingClientRect().height > 0));
}

export function sameState(a: GlassState | null, b: GlassState | null): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** The chat's avatar as a png, from the canvases and images the page drew it with. */
export function rasterAvatar(host: Element | null): string | null {
  if (!host) return null;
  const box = host.getBoundingClientRect();
  if (!box.width || !box.height) return null;
  const scale = 3;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(box.width * scale);
  canvas.height = Math.round(box.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.imageSmoothingEnabled = false;
  let drawn = 0;
  for (const part of host.querySelectorAll<HTMLCanvasElement | HTMLImageElement>("canvas, img")) {
    const r = part.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    try {
      ctx.drawImage(part, (r.left - box.left) * scale, (r.top - box.top) * scale, r.width * scale, r.height * scale);
      drawn += 1;
    } catch { /* an image still loading */ }
  }
  if (!drawn) return null;
  try { return canvas.toDataURL("image/png"); } catch { return null; }
}

const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;

/** Types into the page's own field as a person would, so its mentions, commands and draft all follow. */
export function typeInto(field: HTMLTextAreaElement, text: string): void {
  if (field.value === text) return;
  setValue?.call(field, text);
  field.setSelectionRange(text.length, text.length);
  field.dispatchEvent(new Event("input", { bubbles: true }));
}

function spoken(strip: Element | null): string {
  if (!strip) return "";
  return [...strip.childNodes].filter((node) => !(node instanceof Element && (node.matches(".sr-only") || node.querySelector("canvas, svg")))).map((node) => node.textContent ?? "").join(" ").trim();
}

function readHeader(nav: Element): GlassHeader | null {
  const back = nav.querySelector("[data-glass=back]");
  const title = nav.querySelector("[data-glass=title]");
  const right = nav.querySelector<HTMLElement>("[data-glass=right]");
  if (!back || !title) return null;
  return {
    back: frameOf(back),
    title: frameOf(title),
    right: right ? frameOf(right) : null,
    name: title.querySelector("[data-glass-name]")?.textContent ?? "",
    live: Boolean(right?.querySelector("[data-glass-live]")),
    backLabel: back.getAttribute("aria-label") ?? "",
    titleLabel: title.getAttribute("aria-label") ?? "",
    rightLabel: right?.getAttribute("aria-label") ?? "",
  };
}

function readComposer(shell: HTMLElement, baseline: number): { composer: GlassComposer; elements: HTMLElement[]; field: HTMLTextAreaElement | null } | null {
  if (hasStrips(shell)) return null;
  const field = shell.querySelector<HTMLTextAreaElement>("textarea");
  const actions = composerButtons(shell.querySelector("[data-composer-actions]"));
  if (!actions) return null;
  const voiceStrip = shell.querySelector("[data-composer-voice]");
  const recording = Boolean(voiceStrip) || Boolean(field?.closest(".hidden"));
  if (!field && !recording) return null;
  const frame = frameOf(shell);
  const plus = shell.querySelector("[data-composer-plus]");
  return {
    composer: {
      frame,
      gap: round(baseline - (frame.y + frame.h)),
      plus: Boolean(plus),
      plusLabel: plus?.closest("button")?.getAttribute("aria-label") ?? plus?.getAttribute("aria-label") ?? "",
      placeholder: field?.placeholder ?? "",
      disabled: Boolean(field?.disabled),
      voice: recording ? spoken(voiceStrip) : null,
      buttons: actions.buttons,
      returnSends: field?.getAttribute("enterkeyhint") === "send",
    },
    elements: actions.elements,
    field,
  };
}

function cssPx(root: HTMLElement, expression: string): number {
  const probe = document.createElement("div");
  probe.style.cssText = `position:absolute;visibility:hidden;height:${expression}`;
  root.appendChild(probe);
  const value = probe.getBoundingClientRect().height;
  probe.remove();
  return value;
}

/** While a chat is open, the native glass draws its header and composer: every frame the page's own chrome is measured
 * and anything that moved goes to the native side, which also takes the taps and typing and hands them back here. The
 * page's chrome stays in place, transparent, so its layout, menus and focus all keep working. */
export function useNativeGlass(platform: MobilePlatform, rootRef: RefObject<HTMLElement | null>, chatOpen: boolean) {
  useEffect(() => {
    const glass = platform.glass;
    const root = rootRef.current;
    if (!glass || !root || !chatOpen) return;
    const html = document.documentElement;
    let frame = 0;
    let last: GlassState | null = null;
    let elements: HTMLElement[] = [];
    let field: HTMLTextAreaElement | null = null;
    let fromNative = "";
    let toNative: string | null = null;
    let seq = 0;
    let avatar: string | null | undefined;
    let avatarTick = 0;
    let nativeFocused = false;
    let safeBottom = cssPx(root, "var(--m-safe-bottom)");

    const chat = () => root.querySelector<HTMLElement>("[data-mobile-chat]");
    const nav = () => chat()?.querySelector<HTMLElement>("[data-glass-nav]") ?? null;
    const shell = () => chat()?.querySelector<HTMLElement>('[data-tour="composer"]') ?? null;

    const tick = () => {
      frame = requestAnimationFrame(tick);
      if (document.hidden) return;
      const chatEl = chat();
      const navEl = nav();
      const shellEl = shell();
      const title = navEl?.querySelector("[data-glass=title]");
      const header = chatEl && navEl && title && !covered(title, chatEl) ? readHeader(navEl) : null;
      const moving = root.dataset.kbMoving !== undefined;
      const kb = parseFloat(root.style.getPropertyValue("--m-kb")) || 0;
      const baseline = window.innerHeight - Math.max(safeBottom, kb);
      const read = chatEl && shellEl && !covered(shellEl, chatEl) ? readComposer(shellEl, baseline) : null;
      if (read && moving && last?.composer) read.composer.gap = last.composer.gap;
      elements = read?.elements ?? [];
      field = read?.field ?? null;
      const styles = getComputedStyle(root);
      const next: GlassState = {
        dark: html.dataset.skin === "grok-dark" || root.dataset.scheme === "dark",
        accent: styles.getPropertyValue("--color-accent").trim(),
        header,
        composer: read?.composer ?? null,
      };
      if (header) html.dataset.nativeGlassHeader = ""; else delete html.dataset.nativeGlassHeader;
      if (next.composer) html.dataset.nativeGlassComposer = ""; else delete html.dataset.nativeGlassComposer;
      if (!sameState(last, next)) {
        last = next;
        glass.update(next);
      }
      // what the page itself put in its field (a draft, a cleared send, a picked mention) goes to the native field
      if (field && field.value !== fromNative && field.value !== toNative) {
        toNative = field.value;
        seq += 1;
        glass.setText(field.value, seq);
      }
      if (header && (avatar === undefined || ++avatarTick % 30 === 0)) {
        const next = rasterAvatar(navEl!.querySelector("[data-glass-avatar]"));
        if (next !== avatar) { avatar = next; glass.setAvatar(next); }
      }
    };

    const click = (el: Element | null | undefined) => (el instanceof HTMLElement ? el : null)?.click();
    const stop = glass.onEvent((event) => {
      switch (event.type) {
        case "tap": {
          if (event.target === "plus") click(shell()?.querySelector("[data-composer-plus]")?.closest("button") ?? shell()?.querySelector("[data-composer-plus]"));
          else click(nav()?.querySelector(`[data-glass=${event.target}]`));
          break;
        }
        case "button": click(elements[event.index]); break;
        case "text": {
          fromNative = event.text;
          toNative = null;
          const target = field ?? shell()?.querySelector("textarea");
          if (target) typeInto(target, event.text);
          break;
        }
        case "submit": {
          const target = field ?? shell()?.querySelector("textarea");
          target?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true, cancelable: true }));
          break;
        }
        case "focus": {
          nativeFocused = event.focused;
          if (event.focused) root.dataset.glassFocused = ""; else delete root.dataset.glassFocused;
          break;
        }
        case "height": shell()?.style.setProperty("--glass-composer-h", `${event.height}px`); break;
      }
    });

    // the page focusing its own field (a reply, "answer in the chat below") raises the native one instead
    const onFocus = (event: FocusEvent) => {
      const target = event.target;
      if (!(target instanceof HTMLTextAreaElement) || html.dataset.nativeGlassComposer === undefined || !shell()?.contains(target)) return;
      target.blur();
      glass.focus();
    };
    const onResize = () => { safeBottom = cssPx(root, "var(--m-safe-bottom)"); };
    document.addEventListener("focus", onFocus, true);
    window.addEventListener("resize", onResize);
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      stop();
      document.removeEventListener("focus", onFocus, true);
      window.removeEventListener("resize", onResize);
      if (nativeFocused) glass.blur();
      delete root.dataset.glassFocused;
      delete html.dataset.nativeGlassHeader;
      delete html.dataset.nativeGlassComposer;
      glass.clear();
    };
  }, [platform, rootRef, chatOpen]);
}
