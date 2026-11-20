// @vitest-environment happy-dom
import { act, createElement, createRef, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it } from "vitest";
import { ComputerFullscreen, type ScreenControl } from "@/components/ComputerFullscreen";
import { PlatformContext, type MobilePlatform } from "./platform";
import { ScreenTrackpad, type RemoteInput } from "./ScreenTrackpad";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;

const phone = { kind: "ios", native: true, haptic() {}, orientation: { allowLandscape() {}, rotate() {} } } as unknown as MobilePlatform;
const held: ScreenControl = { held: true, onDone: () => {} };
let root: Root | null = null;

function turn(landscape: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: query.includes("landscape") ? landscape : false, media: query,
    addEventListener() {}, removeEventListener() {},
  })) as unknown as typeof window.matchMedia;
}

async function open({ landscape, trackpad = true }: { landscape: boolean; trackpad?: boolean }) {
  turn(landscape);
  const sent: Array<[number, number, number]> = [];
  const input: RemoteInput = { size: () => ({ width: 1280, height: 800 }), pointer: (x, y, mask) => sent.push([x, y, mask]), key() {}, text() {} };
  const screen = createRef<HTMLDivElement>();
  const keyboard = createRef<HTMLInputElement>();
  const frame: ReactNode = createElement("div", { className: "relative" },
    createElement("div", { ref: screen }, createElement("canvas")),
    trackpad && createElement(ScreenTrackpad, { screen, input, keyboard, label: "screen" }));
  const host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  await act(async () => root!.render(createElement(PlatformContext.Provider, { value: phone },
    createElement(ComputerFullscreen, { label: "Nova's computer", onExit() {}, frame, note: null, control: held, onKeyboard() {} }))));
  // happy-dom lays nothing out: the picture is 1280 wide at a scale of one css px per desktop px
  const canvas = document.querySelector("canvas")!;
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, right: 1280, bottom: 800, width: 1280, height: 800, x: 0, y: 0, toJSON() {} });
  const viewer = document.querySelector<HTMLElement>("[data-computer-fullscreen]")!;
  return { sent, viewer };
}

const touch = (target: Element, type: string, x: number, y: number, timeStamp = 0) =>
  target.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 7, pointerType: "touch", clientX: x, clientY: y, timeStamp } as PointerEventInit));

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

it("a finger on the dark margin around the picture drives the cursor as on the picture", async () => {
  const { sent, viewer } = await open({ landscape: true });
  const margin = viewer.querySelector("[data-computer-frame]")!.parentElement!;
  await act(async () => {
    touch(margin, "pointerdown", 10, 200);
    touch(margin, "pointerup", 10, 200, 60);
  });
  expect(sent).toEqual([[640, 400, 0], [640, 400, 1], [640, 400, 0]]);
  expect(viewer.style.getPropertyValue("touch-action")).toBe("none");
});

it("the viewer's buttons keep their own touches", async () => {
  const { sent, viewer } = await open({ landscape: true });
  for (const button of viewer.querySelectorAll("button")) {
    await act(async () => {
      touch(button, "pointerdown", 10, 10);
      touch(button, "pointerup", 10, 10, 60);
    });
  }
  // the cursor is only shown where it rests, never clicked
  expect(sent.filter(([, , mask]) => mask !== 0)).toEqual([]);
});

it("the margins hand touches back once the trackpad goes", async () => {
  const { viewer } = await open({ landscape: true });
  act(() => root?.unmount());
  root = null;
  expect(viewer.style.getPropertyValue("touch-action")).toBe("");
});

it("sideways, the control pill leaves the picture for the side column with the phone's buttons", async () => {
  const { viewer } = await open({ landscape: true, trackpad: false });
  const pill = viewer.querySelector("[data-computer-control]")!;
  expect(pill.closest("[data-computer-phone-bar]")).not.toBeNull();
  expect(pill.hasAttribute("data-compact")).toBe(true);
  expect(pill.textContent).toContain("Stop");
});

it("upright, the control pill stays under the picture at full size", async () => {
  const { viewer } = await open({ landscape: false, trackpad: false });
  const pill = viewer.querySelector("[data-computer-control]")!;
  expect(pill.closest("[data-computer-phone-bar]")).toBeNull();
  expect(pill.hasAttribute("data-compact")).toBe(false);
});
