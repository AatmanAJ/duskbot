import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { listenLiveFrames } from "@/lib/live-events";
import { friendlyError } from "@/lib/plain-error";
import { ApiError } from "@/state/api";
import { api } from "@/state/store";
import { demoStepHasValue, isDemoBlankName, type DemoDraft, type DemoPlace, type DemoStep } from "../../shared/demo-recording";
import { Check, Loader2, LockKeyhole, Trash2 } from "../icons";
import { askConfirm } from "./ConfirmDialog";
import { mdPrimaryCls, mdSecondaryCls, smallButtonCls } from "./ui/GrokDialog";

type LocaleKey = Parameters<typeof t>[0];
type Saved = { skill: string; routineId?: string; routineError?: string };

const ERRORS: Record<string, LocaleKey> = {
  "not-held": "showOnce.error.notHeld",
  "no-browser": "showOnce.error.noBrowser",
  "no-page": "showOnce.error.noPage",
  "no-folder": "showOnce.error.noFolder",
};

const idle = (botId: string): DemoDraft =>
  ({ botId, state: "idle", place: "browser", startedAt: null, title: "", startUrl: "", steps: [], blanks: [], named: null, revision: 0 });

/** A line of words with pieces of the page set into it: "Type {value} into {target}". */
function filled(key: LocaleKey, parts: Record<string, ReactNode>): ReactNode[] {
  return t(key).split(/(\{\w+\})/u).filter(Boolean).map((piece, at) => {
    const name = /^\{(\w+)\}$/u.exec(piece)?.[1];
    return <span key={at}>{name && name in parts ? parts[name] : piece}</span>;
  });
}

const targetName = (step: DemoStep) => step.target?.name || step.target?.label || step.target?.placeholder || "";

function shortUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.host}${parsed.pathname === "/" ? "" : parsed.pathname}`;
  } catch {
    return url;
  }
}

function BlankChip({ name, onRename }: { name: string; onRename: (to: string) => Promise<boolean> }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const [bad, setBad] = useState(false);
  const commit = async () => {
    const next = draft.trim().toLowerCase().replace(/[\s-]+/gu, "_");
    if (next === name) return setEditing(false);
    if (!isDemoBlankName(next) || !(await onRename(next))) return setBad(true);
    setEditing(false);
  };
  const onKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") { event.preventDefault(); void commit(); }
    if (event.key === "Escape") { event.preventDefault(); setDraft(name); setBad(false); setEditing(false); }
  };
  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        aria-label={t("showOnce.blank.name")}
        aria-invalid={bad}
        spellCheck={false}
        maxLength={40}
        size={Math.max(6, draft.length + 1)}
        onChange={(event) => { setDraft(event.target.value); setBad(false); }}
        onBlur={() => void commit()}
        onKeyDown={onKey}
        className={cn("mx-0.5 h-[22px] rounded-md bg-accent/12 px-1.5 font-mono text-[12px] leading-[18px] text-accent-text outline-none ring-1 ring-inset", bad ? "ring-danger" : "ring-accent/40")}
      />
    );
  }
  return (
    <button
      type="button"
      title={t("showOnce.blank.rename", { name })}
      aria-label={t("showOnce.blank.rename", { name })}
      onClick={() => { setDraft(name); setBad(false); setEditing(true); }}
      className="mx-0.5 inline-flex h-[22px] cursor-pointer items-center rounded-md bg-accent/12 px-1.5 align-baseline font-mono text-[12px] leading-[18px] text-accent-text hover:bg-accent/20 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus"
    >
      {name}
    </button>
  );
}

function StepLine({ step, onRename }: { step: DemoStep; onRename: (from: string, to: string) => Promise<boolean> }) {
  const name = targetName(step);
  const target = <span className="font-medium text-ink" dir="auto">{name ? `“${name}”` : t("showOnce.step.page")}</span>;
  const value = step.blank
    ? <BlankChip name={step.blank} onRename={(to) => onRename(step.blank!, to)} />
    : <span className="text-ink" dir="auto">{`“${step.value ?? ""}”`}</span>;
  switch (step.kind) {
    case "open": return <>{filled("showOnce.step.open", { url: <span className="text-ink" dir="ltr">{shortUrl(step.url ?? "")}</span> })}</>;
    case "click": return <>{filled("showOnce.step.click", { target })}</>;
    case "fill": return <>{filled("showOnce.step.fill", { value, target })}</>;
    case "select": return <>{filled("showOnce.step.select", { value, target })}</>;
    case "choose": return <>{filled("showOnce.step.choose", { value, target })}</>;
    case "check":
      if (step.blank) return <>{filled("showOnce.step.checkBlank", { value, target })}</>;
      return <>{filled(step.checked === false ? "showOnce.step.uncheck" : "showOnce.step.check", { target })}</>;
    case "press": return <>{filled("showOnce.step.press", { key: <kbd className="rounded bg-ink/6 px-1 font-sans text-[12px] text-ink">{step.key}</kbd>, target })}</>;
    case "upload": return <>{filled("showOnce.step.upload", { value, target })}</>;
    case "sign-in": return <>{filled("showOnce.step.signIn", { site: <span className="text-ink" dir="ltr">{step.site ?? ""}</span> })}</>;
    case "protected": return <>{filled("showOnce.step.protected", { target })}</>;
  }
}

export type DemoRecorderVariant = "drawer" | "card" | "side";

export interface DemoRecorderProps {
  botId: string;
  botName: string;
  place: DemoPlace;
  /** The person holds control here, so what they do can be recorded. */
  canRecord: boolean;
  /** Where the view shares the browser with the bot: takes control of it, so Record can start once it is the person's. */
  take?: () => void;
  /** Hands back the control `take` took, once the recording has stopped. */
  release?: () => void;
  /** The Record button's look, where the view around it has its own button style. */
  buttonClassName?: string;
}

const SHELL: Record<DemoRecorderVariant, string> = {
  drawer: "shrink-0 border-t border-ink/8 bg-card",
  card: "mt-3 shrink-0 rounded-xl bg-ink/[0.04]",
  side: "flex min-h-0 w-[340px] shrink-0 flex-col overflow-hidden rounded-xl bg-ink/[0.04] max-md:max-h-[45%] max-md:w-full",
};
/** How long Record waits for the browser to become the person's before it says so. */
const TAKE_WAIT_MS = 10_000;
const TAKE_RETRY_MS = 400;

/**
 * Show it once: Record while the person holds the bot's browser, the steps as they are recorded and edited, and the
 * save as a skill or a routine. `button` and `panel` are placed by the view that hosts them. Security: nothing here
 * holds a password; a sign-in is one line that names the vault.
 */
export function useDemoRecorder({ botId, botName, place, canRecord, take, release, buttonClassName }: DemoRecorderProps) {
  const [draft, setDraft] = useState<DemoDraft>(() => idle(botId));
  const [pending, setPending] = useState<"" | "start" | "stop" | "save">("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState<Saved | null>(null);
  const [askFolder, setAskFolder] = useState(false);
  const [folder, setFolder] = useState("");
  const [title, setTitle] = useState("");
  const took = useRef(false);
  const list = useRef<HTMLOListElement>(null);
  const base = `/api/bots/${botId}/demo-recording`;

  const takeDraft = useCallback((next: DemoDraft | undefined) => {
    if (!next || next.botId !== botId) return;
    setDraft((current) => (next.revision >= current.revision ? next : current));
  }, [botId]);

  useEffect(() => {
    setDraft(idle(botId));
    setSaved(null);
    setError("");
    return listenLiveFrames({ onFrame: (frame) => { if (frame.kind === "demo-recording" && frame.botId === botId) takeDraft(frame.draft); } });
  }, [botId, takeDraft]);
  // A recording this window did not see start (another window's, or one from before a reload) is asked for once the
  // person holds control here; while they do not, the events feed is what brings a draft.
  useEffect(() => {
    if (!canRecord) return;
    let live = true;
    api<{ draft?: DemoDraft } | undefined>(base, { background: true }).then((answer) => { if (live) takeDraft(answer?.draft); }, () => undefined);
    return () => { live = false; };
  }, [base, canRecord, takeDraft]);

  useEffect(() => { setTitle(draft.title); }, [draft.title]);
  const count = draft.steps.length;
  useEffect(() => {
    if (draft.state === "recording") list.current?.lastElementChild?.scrollIntoView?.({ block: "nearest" });
  }, [count, draft.state]);

  const fail = (cause: unknown) => {
    const body = cause instanceof ApiError ? cause.body : undefined;
    const code = typeof body?.code === "string" ? body.code : "";
    const key = ERRORS[code] ?? (code === "invalid" && typeof body?.error === "string" && body.error.includes("lowercase") ? "showOnce.error.blankName" : null);
    setError(key ? t(key, { name: botName }) : friendlyError(cause, t("showOnce.error.generic")));
  };

  /** One change sent to the app's own recorder; the list it answers with replaces the one shown. */
  const send = async (path: string, method: string, body?: unknown): Promise<boolean> => {
    setError("");
    try {
      const answer = await api<{ draft?: DemoDraft } | undefined>(`${base}${path}`, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      takeDraft(answer?.draft);
      return true;
    } catch (cause) {
      fail(cause);
      return false;
    }
  };

  /** The browser goes back to the bot once a recording this view took it for is over. */
  const letGo = () => {
    if (!took.current) return;
    took.current = false;
    release?.();
  };
  /** Starts the recording. Where this view has just asked for the browser, the start is tried again until it is the person's. */
  const begin = async (waitForHold: boolean) => {
    setSaved(null);
    setError("");
    setPending("start");
    const until = Date.now() + (waitForHold ? TAKE_WAIT_MS : 0);
    for (;;) {
      try {
        const answer = await api<{ draft?: DemoDraft } | undefined>(`${base}/start`, { method: "POST", body: JSON.stringify({ place }) });
        takeDraft(answer?.draft);
        break;
      } catch (cause) {
        const code = cause instanceof ApiError && typeof cause.body?.code === "string" ? cause.body.code : "";
        if (code === "not-held" && Date.now() < until) {
          await new Promise((resolve) => setTimeout(resolve, TAKE_RETRY_MS));
          continue;
        }
        fail(cause);
        letGo();
        break;
      }
    }
    setPending("");
  };
  const start = () => {
    if (!take) return void begin(false);
    took.current = true;
    take();
    void begin(true);
  };

  const stop = async () => {
    setPending("stop");
    await send("/stop", "POST");
    setPending("");
    letGo();
  };
  const discard = async () => {
    if (count && !(await askConfirm({ title: t("showOnce.discard.title"), body: t("showOnce.discard.body"), confirmLabel: t("showOnce.discard"), tone: "danger" }))) return;
    setAskFolder(false);
    if (await send("/discard", "POST")) letGo();
  };
  const saveTitle = async () => {
    const next = title.trim();
    if (!next) return setTitle(draft.title);
    if (next !== draft.title) await send("/title", "POST", { title: next });
  };
  const save = async (as: "skill" | "routine") => {
    setError("");
    setPending("save");
    try {
      if (title.trim() && title.trim() !== draft.title) await api(`${base}/title`, { method: "POST", body: JSON.stringify({ title: title.trim() }) });
      const answer = await api<Saved>(`${base}/save`, { method: "POST", body: JSON.stringify({ as, ...(as === "routine" && folder.trim() ? { folder: folder.trim() } : {}) }) });
      setSaved(answer);
      setAskFolder(false);
      setFolder("");
      setDraft((current) => ({ ...idle(botId), revision: current.revision }));
      letGo();
    } catch (cause) {
      fail(cause);
    }
    setPending("");
  };

  const recording = draft.state === "recording";
  const review = draft.state === "review";
  const starting = pending === "start";

  const button = (
    <button type="button" className={cn(buttonClassName ?? mdSecondaryCls, "gap-1.5")} disabled={starting} onClick={start} data-demo-action="record">
      {starting ? <Loader2 size={12} className="animate-spin" aria-hidden="true" /> : <span className="size-2 rounded-full bg-danger" aria-hidden="true" />}
      {t("showOnce.record")}
    </button>
  );

  const counts = (
    <span className="shrink-0 tabular-nums text-ink-tertiary">
      {count === 1 ? t("showOnce.steps.one") : t("showOnce.steps.many", { count })}
      {review && draft.blanks.length > 0 && ` · ${draft.blanks.length === 1 ? t("showOnce.blanks.one") : t("showOnce.blanks.many", { count: draft.blanks.length })}`}
    </span>
  );

  const panel = (variant: DemoRecorderVariant = "drawer"): ReactNode => {
    const wraps = variant === "side";
    const shell = cn("text-[13px] leading-[18px] text-ink-secondary", SHELL[variant]);
    if (saved) {
      return (
        <section className={shell} aria-label={t("showOnce.review")} data-demo-recorder="saved">
          <div className={cn("flex items-start gap-2 px-3 py-2.5", wraps && "flex-wrap")}>
            <Check size={14} className="mt-0.5 shrink-0 text-success" aria-hidden="true" />
            <div className={cn("min-w-0 flex-1", wraps && "basis-[calc(100%-22px)]")} role="status">
              <div className="text-ink">{filled("showOnce.saved", { skill: <span className="font-mono text-[12px]">{saved.skill}</span> })}</div>
              <div>{t("showOnce.saved.hint", { name: botName })}</div>
              {saved.routineId && <div>{t("showOnce.saved.routine")}</div>}
              {saved.routineError && <div className="text-danger">{t("showOnce.saved.routineFailed")}</div>}
            </div>
            <div className={cn("flex shrink-0 gap-2", wraps && "ms-auto")}>
              {(canRecord || take) && <button type="button" className={smallButtonCls} onClick={start}>{t("showOnce.again")}</button>}
              <button type="button" className={smallButtonCls} onClick={() => setSaved(null)}>{t("showOnce.done")}</button>
            </div>
          </div>
        </section>
      );
    }
    if (!recording && !review) return null;
    return (
      <section className={shell} aria-label={t(recording ? "showOnce.recording" : "showOnce.review")} data-demo-recorder={draft.state}>
        <div className="flex min-h-10 shrink-0 items-center gap-2 px-3 py-1.5">
          {recording ? (
            <>
              <span className="relative flex size-2 shrink-0" aria-hidden="true">
                <span className="absolute inline-flex size-full rounded-full bg-danger opacity-60 motion-safe:animate-ping" />
                <span className="relative inline-flex size-2 rounded-full bg-danger" />
              </span>
              <span className="font-medium text-ink">{t(pending === "stop" ? "showOnce.stopping" : "showOnce.recording")}</span>
              {counts}
              <span className="min-w-0 flex-1" />
              <button type="button" className={mdPrimaryCls} disabled={pending === "stop"} onClick={() => void stop()}>
                {pending === "stop" && <Loader2 size={12} className="animate-spin" aria-hidden="true" />}
                {t("showOnce.stop")}
              </button>
            </>
          ) : (
            <>
              <input
                value={title}
                aria-label={t("showOnce.title.label")}
                placeholder={t("showOnce.title.placeholder")}
                maxLength={80}
                dir="auto"
                onChange={(event) => setTitle(event.target.value)}
                onBlur={() => void saveTitle()}
                onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
                className="h-7 min-w-0 flex-1 rounded-lg bg-transparent px-1.5 text-[14px] font-medium leading-5 text-ink outline-none placeholder:text-ink/40 hover:bg-ink/4 focus:bg-ink/6"
              />
              {counts}
            </>
          )}
        </div>

        {count === 0 ? (
          <p className="px-3 pb-3 text-pretty">{t("showOnce.empty")}</p>
        ) : (
          <ol ref={list} className={cn("flex flex-col overflow-y-auto overscroll-contain px-1.5 pb-1 [scrollbar-width:thin]", variant === "side" ? "min-h-0 flex-1" : variant === "drawer" ? "max-h-[min(38vh,300px)]" : "max-h-[300px]")}>
            {draft.steps.map((step, at) => (
              <li key={step.id} className={cn("group/row flex min-h-[30px] shrink-0 gap-2 rounded-lg px-1.5 py-1 hover:bg-ink/4", wraps ? "items-start" : "items-center")} data-step-kind={step.kind}>
                <span className={cn("w-5 shrink-0 text-end text-[12px] tabular-nums text-ink-tertiary", wraps && "py-[3px] leading-[22px]")} aria-hidden="true">{at + 1}</span>
                <span className={cn("min-w-0 flex-1", wraps ? "break-words py-[3px] leading-[22px]" : "truncate")}>
                  {step.kind === "sign-in" && <LockKeyhole size={12} className="me-1 inline-block align-[-1px] text-ink-tertiary" aria-hidden="true" />}
                  <StepLine step={step} onRename={(from, to) => send("/blanks", "POST", { from, to })} />
                </span>
                {step.kind === "sign-in" && <span className={cn("shrink-0 rounded bg-ink/6 px-1.5 text-[11px] leading-[18px] text-ink-secondary", wraps && "mt-[5px]")}>{t("showOnce.vault")}</span>}
                {step.blank && step.kind !== "check" && variant !== "side" && <span className="max-w-[30%] shrink-0 truncate text-[12px] text-ink-tertiary" dir="auto">{step.value}</span>}
                {demoStepHasValue(step) && (
                  <button
                    type="button"
                    className={cn(smallButtonCls, "hidden focus-visible:inline-flex group-hover/row:inline-flex group-focus-within/row:inline-flex touch:inline-flex")}
                    onClick={() => void send(`/steps/${step.id}`, "PATCH", { blank: step.blank ? null : blankFor(step, draft) })}
                  >
                    {t(step.blank ? "showOnce.blank.keep" : "showOnce.blank.make")}
                  </button>
                )}
                <button
                  type="button"
                  aria-label={t("showOnce.step.delete", { number: at + 1 })}
                  title={t("showOnce.step.delete", { number: at + 1 })}
                  onClick={() => void send(`/steps/${step.id}`, "DELETE")}
                  className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-[6px] text-ink/66 opacity-0 transition-[background-color,color,opacity] duration-[120ms] hover:bg-ink/6 hover:text-ink focus-visible:opacity-100 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus group-hover/row:opacity-100 group-focus-within/row:opacity-100 touch:opacity-100"
                >
                  <Trash2 size={14} />
                </button>
              </li>
            ))}
          </ol>
        )}

        {error && <div role="alert" className="shrink-0 px-3 pb-1.5 text-[12px] text-danger">{error}</div>}

        {review && (
          <div className="flex shrink-0 flex-col gap-2 px-3 pb-2.5 pt-1.5">
            <p className="text-[12px] leading-4 text-ink-tertiary">{t(draft.named === "ai" ? "showOnce.named.ai" : "showOnce.private")}</p>
            {askFolder && (
              <label className="flex flex-col gap-1">
                <span className="text-[11px] leading-4 text-ink/68">{t("showOnce.folder.label")}</span>
                <input
                  autoFocus
                  value={folder}
                  placeholder={t("showOnce.folder.placeholder")}
                  spellCheck={false}
                  dir="ltr"
                  onChange={(event) => setFolder(event.target.value)}
                  onKeyDown={(event) => { if (event.key === "Enter") void save("routine"); }}
                  className="h-8 w-full min-w-0 rounded-[10px] bg-ink/4 px-[9px] font-mono text-[12px] text-ink outline-none placeholder:text-ink/40 focus:bg-ink/7"
                />
              </label>
            )}
            <div className="flex flex-wrap items-center justify-end gap-2">
              <button type="button" className={cn(mdSecondaryCls, "me-auto")} disabled={pending === "save"} onClick={() => void discard()}>{t("showOnce.discard")}</button>
              {askFolder ? (
                <button type="button" className={cn(mdPrimaryCls, wraps && "order-first w-full")} disabled={pending === "save" || count === 0} onClick={() => void save("routine")}>
                  {pending === "save" && <Loader2 size={12} className="animate-spin" aria-hidden="true" />}
                  {t("showOnce.folder.save")}
                </button>
              ) : (
                <>
                  <button type="button" className={mdSecondaryCls} disabled={pending === "save" || count === 0} onClick={() => setAskFolder(true)}>{t("showOnce.save.routine")}</button>
                  <button type="button" className={cn(mdPrimaryCls, wraps && "order-first w-full")} disabled={pending === "save" || count === 0} onClick={() => void save("skill")}>
                    {pending === "save" && <Loader2 size={12} className="animate-spin" aria-hidden="true" />}
                    {t(pending === "save" ? "showOnce.saving" : "showOnce.save.skill")}
                  </button>
                </>
              )}
            </div>
          </div>
        )}
      </section>
    );
  };

  return {
    /** A recording is being made, reviewed, or was just saved: `panel` has something to show. */
    active: recording || review || saved !== null,
    recording,
    /** The Record button, for wherever the hosting view keeps its actions. */
    button,
    /** Why Record did not start, while there is no panel to say it in. */
    error: recording || review ? "" : error,
    panel,
  };
}

/** The recorder as one block: the Record button with a line of what it does, then the steps once there are any. */
export function DemoRecorder({ variant = "drawer", ...props }: DemoRecorderProps & { variant?: DemoRecorderVariant }) {
  const demo = useDemoRecorder(props);
  if (demo.active) return <>{demo.panel(variant)}</>;
  if (!props.canRecord && !props.take) return null;
  return (
    <section className={cn("text-[13px] leading-[18px] text-ink-secondary", SHELL[variant])} aria-label={t("showOnce.record")} data-demo-recorder="idle">
      <div className="flex min-h-10 items-center gap-2.5 px-3 py-1.5">
        {demo.button}
        <span className="min-w-0 flex-1 truncate">{t("showOnce.record.hint", { name: props.botName })}</span>
      </div>
      {demo.error && <div role="alert" className="px-3 pb-2 text-[12px] text-danger">{demo.error}</div>}
    </section>
  );
}

/** A name for a step's new blank, from its field, that no other blank has. */
function blankFor(step: DemoStep, draft: DemoDraft): string {
  const words = targetName(step).normalize("NFKD").replace(/\p{M}+/gu, "").toLowerCase().replace(/[^a-z0-9]+/gu, "_").replace(/^_+|_+$/gu, "").slice(0, 36).replace(/_+$/u, "");
  const base = /^[a-z]/u.test(words) ? words : "value";
  const taken = new Set(draft.blanks.map((blank) => blank.name));
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base}_${n}`)) return `${base}_${n}`;
}
