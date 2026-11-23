// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { MessageAttachmentGallery } from "./AttachmentGallery";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("audio bytes", { headers: { "content-type": "audio/mpeg" } })));
  if (!URL.createObjectURL) Object.assign(URL, { createObjectURL: () => "blob:memo", revokeObjectURL: () => {} });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

it("pressing Play on a voice memo with the keyboard leaves focus on the player, not on the page", async () => {
  await act(async () => {
    root.render(createElement(MessageAttachmentGallery, {
      text: "",
      attachments: [{ kind: "file", path: "/store/memo.mp3", name: "Standup notes.mp3" }],
      message: { threadId: "t1", messageId: "m1" },
    }));
  });
  const play = host.querySelector<HTMLButtonElement>("button[aria-label*='Standup notes.mp3']")!;
  expect(play).toBeTruthy();
  play.focus();
  await act(async () => { play.click(); });
  for (let i = 0; i < 5; i++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  expect(host.querySelector("audio")).not.toBeNull();
  expect(document.activeElement).toBe(host.querySelector("audio"));
});

it("leaves focus where the person moved it while the memo was still loading", async () => {
  let answer!: (response: Response) => void;
  vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => { answer = resolve; })));
  const composer = document.createElement("textarea");
  document.body.append(composer);
  await act(async () => {
    root.render(createElement(MessageAttachmentGallery, {
      text: "",
      attachments: [{ kind: "file", path: "/store/memo.mp3", name: "Standup notes.mp3" }],
      message: { threadId: "t1", messageId: "m1" },
    }));
  });
  const play = host.querySelector<HTMLButtonElement>("button[aria-label*='Standup notes.mp3']")!;
  play.focus();
  await act(async () => { play.click(); });
  composer.focus();
  await act(async () => { answer(new Response("audio bytes", { headers: { "content-type": "audio/mpeg" } })); });
  for (let i = 0; i < 5; i++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  expect(host.querySelector("audio")).not.toBeNull();
  expect(document.activeElement).toBe(composer);
  composer.remove();
});
