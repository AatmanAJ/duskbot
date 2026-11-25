import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { RuntimeEvent, SendTurnInput, TextGenerationOptions } from "../contracts.ts";
import { newId } from "../contracts.ts";

/** The thread id prefix of a hidden turn: never a conversation, never on the app's bus. */
export const HIDDEN_TURN_PREFIX = "background-text-";
export const HIDDEN_TURN_TIMEOUT_MS = 180_000;

/** Every tool, native or MCP, is outside this selection. */
const NO_TOOLS = { allow: [] as string[] };

export interface HiddenTurnRunner {
  send(turn: SendTurnInput): Promise<unknown>;
  stop(threadId: string): Promise<void>;
  /** Ends whatever the driver keeps for the thread (a host process, a session). */
  release?(threadId: string): Promise<void>;
}

/** Background text on an engine with no one-off text call: one turn of its own on the bot's model, in an empty folder,
 * with no tools and no MCP servers, stopped the moment the engine starts a tool or asks for a permission. The driver
 * routes the turn's events here (`take`) instead of to its listeners, so nothing of it reaches a chat. */
export interface HiddenTurns {
  take(event: RuntimeEvent): boolean;
  text(prompt: string, options: TextGenerationOptions, runner: HiddenTurnRunner): Promise<string>;
}

export function createHiddenTurns(): HiddenTurns {
  const handlers = new Map<string, (event: RuntimeEvent) => void>();

  return {
    take(event) {
      if (!event.threadId.startsWith(HIDDEN_TURN_PREFIX)) return false;
      handlers.get(event.threadId)?.(event);
      return true;
    },

    async text(prompt, options, runner) {
      const threadId = `${HIDDEN_TURN_PREFIX}${newId()}`;
      const cwd = mkdtempSync(join(tmpdir(), "dusk-background-text-"));
      const model = options.model ?? options.fallback?.model;
      let finalText = "";
      let streamed = "";
      let lastError = "";
      let usedModel = model ?? "";
      let stopping: Promise<void> | null = null;
      const stop = () => (stopping ??= runner.stop(threadId).catch(() => undefined));
      try {
        return await new Promise<string>((resolve, reject) => {
          let done = false;
          const finish = (error: Error | null, text?: string) => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            options.signal?.removeEventListener("abort", aborted);
            if (error) {
              void stop();
              reject(error);
            } else resolve(text!);
          };
          const timer = setTimeout(() => finish(new Error("The background model call timed out.")), options.timeoutMs ?? HIDDEN_TURN_TIMEOUT_MS);
          timer.unref?.();
          const aborted = () => finish(new Error("cancelled"));
          if (options.signal?.aborted) return aborted();
          options.signal?.addEventListener("abort", aborted, { once: true });

          handlers.set(threadId, (event) => {
            switch (event.type) {
              case "session.started":
                if (event.model) usedModel = event.model;
                return;
              case "content.delta":
                if (event.streamKind === "assistant_text") streamed += event.delta;
                return;
              case "item.completed":
                if (event.itemType === "assistant_text") finalText += (finalText ? "\n" : "") + event.text;
                return;
              case "item.started":
                if (event.itemType === "tool") finish(new Error("the engine asked for a tool in a background call"));
                return;
              case "request.opened":
                finish(new Error("the engine asked for a permission in a background call"));
                return;
              case "runtime.error":
                lastError = event.message;
                return;
              case "turn.completed": {
                if (event.usage) options.onUsage?.({ model: usedModel, input: event.usage.input, output: event.usage.output,
                  ...(event.usage.cachedInput !== undefined ? { cachedInput: event.usage.cachedInput } : {}) });
                const text = (finalText || streamed).trim();
                if (!event.ok) finish(new Error(lastError || `the background call ended (${event.stopReason ?? "failed"})`));
                else if (!text) finish(new Error("the background call wrote nothing"));
                else finish(null, text);
                return;
              }
              default:
                return;
            }
          });
          runner.send({ threadId, text: prompt, cwd, approvalMode: "ask", toolScope: NO_TOOLS, ...(model ? { model } : {}) })
            .catch((error: unknown) => finish(error instanceof Error ? error : new Error(String(error))));
        });
      } finally {
        if (stopping) await stopping;
        handlers.delete(threadId);
        await runner.release?.(threadId).catch(() => undefined);
        try { rmSync(cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch {}
      }
    },
  };
}
