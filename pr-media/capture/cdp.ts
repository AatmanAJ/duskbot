// A headless Chrome driven over the DevTools protocol: just what the media scripts need (navigate, evaluate, screenshot).
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import { removeTempDir, waitForExit } from "../../server/testing/cleanup.ts";

type Params = Record<string, unknown>;

export const CHROME = process.env.PR_MEDIA_CHROME
  ?? join(homedir(), "Library/Caches/ms-playwright/chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing");

export interface Tab {
  send(method: string, params?: Params): Promise<Params>;
  evaluate<T = unknown>(expression: string): Promise<T>;
  goto(url: string): Promise<void>;
  shot(path: string, options?: { format?: "png" | "jpeg"; quality?: number }): Promise<void>;
  close(): Promise<void>;
}

export async function launch(): Promise<{ tab(width: number, height: number, scale: number, init?: string): Promise<Tab>; close(): Promise<void> }> {
  const profile = mkdtempSync(join(tmpdir(), "duskbot-pr-media-chrome-"));
  const child: ChildProcess = spawn(CHROME, ["--headless=new", "--no-first-run", "--no-default-browser-check", "--disable-background-networking",
    "--disable-component-update", "--disable-sync", "--mute-audio", "--use-mock-keychain", "--password-store=basic", "--hide-scrollbars",
    "--font-render-hinting=none", "--force-color-profile=srgb", `--user-data-dir=${profile}`, "--remote-debugging-port=0", "about:blank"], { stdio: "ignore" });
  const portFile = join(profile, "DevToolsActivePort");
  for (const deadline = Date.now() + 30_000; !existsSync(portFile) || readFileSync(portFile, "utf8").split("\n").length < 2;) {
    if (Date.now() > deadline) throw new Error("Chrome did not start");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const [port, path] = readFileSync(portFile, "utf8").trim().split("\n");
  const socket = new WebSocket(`ws://127.0.0.1:${port}${path}`);
  await new Promise((resolve, reject) => { socket.addEventListener("open", resolve); socket.addEventListener("error", reject); });
  let id = 0;
  const pending = new Map<number, { resolve: (value: Params) => void; reject: (error: Error) => void }>();
  const events = new Map<string, Array<(params: Params) => void>>();
  socket.addEventListener("message", (message) => {
    const data = JSON.parse(String(message.data)) as { id?: number; result?: Params; error?: { message: string }; method?: string; params?: Params; sessionId?: string };
    if (data.id !== undefined) {
      const waiter = pending.get(data.id);
      pending.delete(data.id);
      if (data.error) waiter?.reject(new Error(data.error.message)); else waiter?.resolve(data.result ?? {});
    } else if (data.method) for (const fn of events.get(`${data.sessionId}:${data.method}`) ?? []) fn(data.params ?? {});
  });
  const send = (method: string, params: Params = {}, sessionId?: string) => new Promise<Params>((resolve, reject) => {
    const n = ++id;
    pending.set(n, { resolve, reject });
    socket.send(JSON.stringify({ id: n, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  return {
    async tab(width, height, scale, init) {
      const { targetId } = await send("Target.createTarget", { url: "about:blank" }) as { targetId: string };
      const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true }) as { sessionId: string };
      const s = (method: string, params: Params = {}) => send(method, params, sessionId);
      await s("Page.enable");
      await s("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: scale, mobile: false });
      if (init) await s("Page.addScriptToEvaluateOnNewDocument", { source: init });
      const loaded = () => new Promise<void>((resolve) => {
        const key = `${sessionId}:Page.loadEventFired`;
        const list = events.get(key) ?? [];
        const once = () => { events.set(key, (events.get(key) ?? []).filter((fn) => fn !== once)); resolve(); };
        list.push(once);
        events.set(key, list);
      });
      return {
        send: s,
        async evaluate<T>(expression: string) {
          const result = await s("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }) as { result?: { value?: T }; exceptionDetails?: { exception?: { description?: string }; text?: string } };
          if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
          return result.result?.value as T;
        },
        async goto(url) { const wait = loaded(); await s("Page.navigate", { url }); await wait; },
        async shot(file, options = {}) {
          const { data } = await s("Page.captureScreenshot", { format: options.format ?? "png", ...(options.quality ? { quality: options.quality } : {}), captureBeyondViewport: false }) as { data: string };
          const { writeFileSync } = await import("node:fs");
          writeFileSync(file, Buffer.from(data, "base64"));
        },
        async close() { await send("Target.closeTarget", { targetId }).catch(() => {}); },
      };
    },
    async close() {
      await send("Browser.close").catch(() => {});
      socket.close();
      await waitForExit(child, { signal: "SIGTERM" });
      await removeTempDir(profile);
    },
  };
}
