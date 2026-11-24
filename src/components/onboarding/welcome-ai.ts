import { useCallback, useEffect, useRef, useState } from "react";
import { aiSignInKey, type AiTestState } from "../../../shared/ai-ranking";
import { engineReady } from "@/components/EngineLibrary";
import { welcomeAi } from "@/lib/onboarding";
import { api, type InstanceInfo } from "@/state/store";

type Answer = { ok?: boolean | null; error?: string } | undefined;
type Known = { state: AiTestState; error?: string };

const keyOf = (instance: InstanceInfo) => `${instance.instanceId}\n${aiSignInKey(instance.snapshot)}`;
/** As the new-bot default sees it: an AI that offers no model yet (OpenCode still listing them) can't run a bot. */
const runs = (instance: InstanceInfo) =>
  engineReady(instance) && Boolean(instance.models.default.trim() || instance.models.options.some((option) => option.id.trim()));

/** How long the first run waits on an AI's test message before it shows the cards instead: past the server's own 90 s
 * check, so a slow cold start (Claude Code on Windows) is answered by the server, never cut off here. */
export const WELCOME_CHECK_MS = 100_000;

/** A check that ran out of time is an AI that didn't answer (the cards, with Check again); any other failure to ask trusts it. */
export function checkFailed(error: unknown): Known {
  return error instanceof DOMException && error.name === "TimeoutError" ? { state: "failed" } : { state: "untestable" };
}

export type WelcomeAiNow = NonNullable<ReturnType<typeof welcomeAi<InstanceInfo>>> & {
  /** The plain reason its test failed, when it gave one (signed out, a used-up limit…). */
  error?: string;
  /** Check again: one more test message. */
  retry(): void;
};

/** The AI the welcome stands on (welcomeAi), after one tiny test message through the server's check when this sign-in
 * hasn't had one: the server shares a test already under way, and its result also settles the new-bot default. A check
 * that can't be made trusts the AI as before. `enabled` is false for a viewer who can't run checks. */
export function useWelcomeAi(instances: readonly InstanceInfo[], enabled = true): WelcomeAiNow | null {
  const [answers, setAnswers] = useState<Record<string, Known>>({});
  const asked = useRef(new Set<string>());
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  const ask = useCallback((key: string) => {
    if (asked.current.has(key)) return;
    asked.current.add(key);
    const instanceId = key.slice(0, key.indexOf("\n"));
    void api<Answer>(`/api/instances/${encodeURIComponent(instanceId)}/check`, { method: "POST", body: "{}", timeoutMs: WELCOME_CHECK_MS })
      .then((answer): Known => answer?.ok === true ? { state: "passed" } : answer?.ok === false
        ? { state: "failed", ...(answer.error ? { error: answer.error } : {}) } : { state: "untestable" }, checkFailed)
      .then((known) => {
        asked.current.delete(key);
        if (live.current) setAnswers((current) => ({ ...current, [key]: known }));
      });
  }, []);
  const known = (instance: InstanceInfo): Known | undefined => answers[keyOf(instance)]
    ?? (instance.aiTest && instance.aiTest !== "testing" ? { state: instance.aiTest, ...(instance.aiTestError ? { error: instance.aiTestError } : {}) } : undefined);
  const found = welcomeAi(instances, runs, (instance) => known(instance)?.state);
  const asking = enabled && found?.state === "testing" ? keyOf(found.instance) : null;
  useEffect(() => {
    if (asking) ask(asking);
  }, [asking, ask]);
  if (!found) return null;
  const key = keyOf(found.instance);
  const error = found.state === "failed" ? known(found.instance)?.error : undefined;
  return {
    ...found,
    ...(error ? { error } : {}),
    retry: () => {
      if (!enabled) return;
      setAnswers((current) => ({ ...current, [key]: { state: "testing" } }));
      ask(key);
    },
  };
}

export type AiLine =
  /** an AI of the person's own answered (or can't be tested and is trusted) */
  | "ready"
  /** an AI of their own is being sent its test message */
  | "checking"
  /** none of their own works, the free backup does: the bot runs on it, and signing in is a chip in its chat */
  | "free"
  /** nothing can answer the bot yet: the one case the first run asks for a sign-in before the chat */
  | "connect";

/** Where the first run stands on the AI: anything but "connect" goes straight to the chat. */
export function aiLine(own: { state: AiTestState } | null, backupReady: boolean): AiLine {
  if (own?.state === "passed" || own?.state === "untestable") return "ready";
  if (own?.state === "testing") return "checking";
  return backupReady ? "free" : "connect";
}
