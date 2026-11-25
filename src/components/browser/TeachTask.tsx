import { useCallback, useEffect, useRef, useState } from "react";
import { Globe, Keyboard, LockKeyhole, MousePointerClick, X } from "../../icons";
import { TEACH_LIMITS, teachMessage, type TaughtStep, type TaughtTarget, type TeachStatus } from "../../../shared/teach-task";
import { t } from "@/lib/i18n";
import { friendlyError } from "@/lib/plain-error";
import { elapsed, readTeach, sendTeach, useTeachRequest, type TeachAction } from "@/lib/teach-task";
import { useStore, type Bot } from "@/state/store";

const POLL_MS = 1_000;
const ghost = "rounded-lg px-3 py-1.5 text-[12px] text-ink-secondary hover:bg-inset hover:text-ink disabled:opacity-40";

/** The recording a person makes in this bot's browser, and the review that hands it to the bot. */
export function useTeachTask({ bot, scope, connected, takeControl }: { bot: Bot; scope: Readonly<Record<string, string>>; connected: boolean; takeControl: () => void }) {
  const { dispatch } = useStore();
  const [status, setStatus] = useState<TeachStatus | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const scopeKey = JSON.stringify(scope);
  const scoped = useRef(scope);
  scoped.current = scope;

  const settle = useCallback((next: TeachStatus) => {
    setStatus(next);
    if (!next.recording && next.stopped) setReviewing(true);
  }, []);

  const run = useCallback(async (action: TeachAction) => {
    setBusy(true);
    setError("");
    try {
      const next = await sendTeach(bot.id, scoped.current, action);
      if (action === "discard") { setStatus(null); setReviewing(false); } else settle(next);
      return next;
    } catch (cause) {
      setError(friendlyError(cause));
      return null;
    } finally { setBusy(false); }
  }, [bot.id, settle]);

  useEffect(() => {
    if (!connected) return;
    let active = true;
    void readTeach(bot.id, scoped.current).then((next) => { if (active && (next.recording || next.steps.length)) settle(next); }).catch(() => {});
    return () => { active = false; };
  }, [bot.id, scopeKey, connected, settle]);

  const recording = status?.recording === true;
  useEffect(() => {
    if (!recording) return;
    const timer = setInterval(() => {
      setNow(Date.now());
      void readTeach(bot.id, scoped.current).then(settle).catch(() => {});
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [bot.id, recording, settle]);

  const start = useCallback(async () => {
    if (await run("start")) { setReviewing(false); takeControl(); }
  }, [run, takeControl]);
  const pending = useRef(false);
  useTeachRequest(bot.id, () => { pending.current = true; if (connected) { pending.current = false; void start(); } });
  useEffect(() => { if (connected && pending.current) { pending.current = false; void start(); } }, [connected, start]);

  const teach = async (draft: { name: string; purpose: string; steps: TaughtStep[] }) => {
    dispatch({ type: "send", botId: bot.id, threadId: bot.threadId, text: teachMessage(draft) });
    await run("discard");
  };

  return { status, recording, reviewing, error, busy, now, start, stop: () => void run("stop"), discard: () => void run("discard"), teach, clearError: () => setError("") };
}

export type TeachTask = ReturnType<typeof useTeachTask>;

export function TeachBar({ task, botName, you, onTake }: { task: TeachTask; botName: string; you: boolean; onTake: () => void }) {
  if (task.error && !task.reviewing) {
    return <div role="alert" className="flex shrink-0 items-center justify-between gap-2 border-b border-transparent px-3 py-2 text-[12px] text-danger">
      <span>{task.error}</span><button type="button" className="shrink-0 underline" onClick={task.clearError}>{t("browser.teach.dismiss")}</button>
    </div>;
  }
  if (!task.recording || !task.status) return null;
  const steps = task.status.steps.filter((step) => step.kind !== "page").length;
  const left = Math.max(0, (task.status.endsAt ?? 0) - task.now);
  return <div role="status" aria-live="polite" className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-danger/30 bg-danger/10 px-3 py-2 text-[12px] text-ink">
    <span className="relative flex size-2.5 shrink-0" aria-hidden="true">
      <span className="absolute inline-flex size-full animate-ping rounded-full bg-danger opacity-60" />
      <span className="relative inline-flex size-2.5 rounded-full bg-danger shadow-[0_0_8px_var(--color-danger)]" />
    </span>
    <span className="font-medium">{t("browser.teach.recording", { name: botName })}</span>
    <span className="tabular-nums text-ink-secondary">{elapsed(task.now - (task.status.startedAt ?? task.now))}</span>
    <span className="text-ink-secondary">{t(steps === 1 ? "browser.teach.stepOne" : "browser.teach.stepMany", { count: steps })}</span>
    {left < 60_000 && <span className="text-danger">{t("browser.teach.endingSoon")}</span>}
    <span className="ms-auto flex items-center gap-2">
      {!you && <button type="button" className={ghost} onClick={onTake}>{t("browser.teach.takeControl")}</button>}
      <button type="button" disabled={task.busy} className="rounded-lg bg-danger px-3 py-1.5 text-[12px] font-medium text-white hover:brightness-110 disabled:opacity-60" onClick={task.stop}>{t("browser.teach.stop")}</button>
    </span>
    <span className="basis-full text-[11px] text-ink-tertiary">{t("browser.teach.privacy")}</span>
  </div>;
}

function targetText(target: TaughtTarget | null): string {
  if (!target) return t("browser.teach.target.page");
  return target.name ? t("browser.teach.target.named", { role: target.role, name: target.name }) : target.role;
}

export function taughtStepText(step: Exclude<TaughtStep, { kind: "page" }>): string {
  switch (step.kind) {
    case "click": return t("browser.teach.step.click", { target: targetText(step.target) });
    case "type": return step.hidden ? t("browser.teach.step.hidden", { target: targetText(step.target) }) : t("browser.teach.step.type", { text: step.text, target: targetText(step.target) });
    case "key": return t("browser.teach.step.key", { key: step.key });
    case "choose": return t("browser.teach.step.choose", { option: step.option });
  }
}

function StepIcon({ step }: { step: TaughtStep }) {
  const Icon = step.kind === "page" ? Globe : step.kind === "type" && step.hidden ? LockKeyhole : step.kind === "type" || step.kind === "key" ? Keyboard : MousePointerClick;
  return <Icon size={13} aria-hidden="true" className={step.kind === "page" ? "text-ink-tertiary" : "text-danger"} />;
}

/** Drops one step, and any page line left with no step under it. */
export function withoutStep(steps: readonly TaughtStep[], at: number): TaughtStep[] {
  const kept = steps.filter((_, index) => index !== at);
  return kept.filter((step, index) => step.kind !== "page" || (kept[index + 1] !== undefined && kept[index + 1]!.kind !== "page"));
}

export function TeachReview({ task, botName }: { task: TeachTask; botName: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [steps, setSteps] = useState<TaughtStep[]>([]);
  const [name, setName] = useState("");
  const [purpose, setPurpose] = useState("");
  const open = task.reviewing && task.status !== null;
  useEffect(() => {
    if (!open) { dialog.current?.close(); return; }
    setSteps(task.status?.steps ?? []);
    setName("");
    setPurpose("");
    if (!dialog.current?.open) dialog.current?.showModal();
  }, [open, task.status]);
  const acts = steps.filter((step) => step.kind !== "page");
  const stopped = task.status?.stopped;
  let number = 0;
  return <dialog ref={dialog} aria-labelledby="teach-review-title" onCancel={(event) => { event.preventDefault(); task.discard(); }} className="ui-dialog m-auto max-h-[85vh] w-[min(520px,calc(100%-32px))] overflow-hidden p-0 text-ink backdrop:bg-black/50">
    {open && <form className="flex max-h-[85vh] flex-col" onSubmit={(event) => { event.preventDefault(); if (acts.length && name.trim()) void task.teach({ name, purpose, steps }); }}>
      <div className="flex items-start justify-between gap-3 border-b border-transparent px-5 pb-3 pt-5">
        <div>
          <h2 id="teach-review-title" className="text-[15px] font-medium">{t("browser.teach.reviewTitle", { name: botName })}</h2>
          <p className="mt-1 text-[12px] leading-relaxed text-ink-secondary">{t("browser.teach.reviewBody", { name: botName })}</p>
        </div>
        <button type="button" className="rounded-md p-1.5 text-ink-secondary hover:bg-inset hover:text-ink" aria-label={t("browser.teach.discard")} onClick={task.discard}><X size={16} /></button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-5 py-3">
        {stopped === "time" || stopped === "steps" ? <p className="text-[12px] text-ink-secondary">{t(stopped === "time" ? "browser.teach.stoppedTime" : "browser.teach.stoppedSteps", { steps: TEACH_LIMITS.steps })}</p> : null}
        <label className="flex flex-col gap-1 text-[12px] text-ink-secondary">{t("browser.teach.nameLabel")}
          <input required autoFocus value={name} maxLength={120} onChange={(event) => setName(event.target.value)} placeholder={t("browser.teach.namePlaceholder")} className="rounded-lg bg-inset px-3 py-2 text-[13px] text-ink outline-none focus:ring-1 focus:ring-focus" />
        </label>
        <label className="flex flex-col gap-1 text-[12px] text-ink-secondary">{t("browser.teach.purposeLabel", { name: botName })}
          <textarea value={purpose} maxLength={600} rows={2} onChange={(event) => setPurpose(event.target.value)} placeholder={t("browser.teach.purposePlaceholder")} className="resize-none rounded-lg bg-inset px-3 py-2 text-[13px] text-ink outline-none focus:ring-1 focus:ring-focus" />
        </label>
        <div className="text-[12px] text-ink-secondary">{t("browser.teach.stepsLabel")}</div>
        {acts.length === 0 ? <p className="rounded-lg bg-inset px-3 py-3 text-[12px] text-ink-secondary">{t("browser.teach.nothing")}</p>
          : <ol className="flex flex-col gap-0.5">
            {steps.map((step, index) => step.kind === "page"
              ? <li key={index} className="flex items-center gap-2 px-1 pt-2 text-[11px] text-ink-tertiary"><StepIcon step={step} /><span className="truncate" title={step.url}>{step.title || step.url}</span></li>
              : <li key={index} className="group flex items-center gap-2 rounded-lg px-2 py-1.5 text-[12px] hover:bg-inset">
                <span className="w-5 shrink-0 text-right tabular-nums text-ink-tertiary">{++number}</span>
                <StepIcon step={step} />
                <span className="min-w-0 flex-1 break-words">{taughtStepText(step)}</span>
                <button type="button" className="shrink-0 rounded-md p-1 text-ink-tertiary opacity-60 hover:bg-card hover:text-ink group-hover:opacity-100" aria-label={t("browser.teach.removeStep", { number })} onClick={() => setSteps((current) => withoutStep(current, index))}><X size={12} /></button>
              </li>)}
          </ol>}
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-transparent px-5 py-3">
        {task.error && <span role="alert" className="me-auto text-[12px] text-danger">{task.error}</span>}
        <button type="button" className={ghost} disabled={task.busy} onClick={task.discard}>{t("browser.teach.discard")}</button>
        <button type="button" className={ghost} disabled={task.busy} onClick={() => void task.start()}>{t("browser.teach.again")}</button>
        <button type="submit" disabled={task.busy || !acts.length || !name.trim()} className="rounded-lg bg-accent px-4 py-2 text-[12px] font-medium text-accent-ink disabled:opacity-40">{t("browser.teach.send", { name: botName })}</button>
      </div>
    </form>}
  </dialog>;
}
