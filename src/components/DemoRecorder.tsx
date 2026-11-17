import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { fixBlank, moveStep, removeStep, renameBlank, updateStep } from "../../shared/demo-plan";
import type { DemoBlank, DemoCheck, DemoFrame, DemoPlan, DemoRecording, DemoReplayRun, DemoStep, DemoSurface } from "../../shared/demo-recording";
import { ArrowDown, ArrowUp, Check, ChevronDown, ChevronUp, CircleAlert, CircleCheck, CircleDashed, FileText, GripVertical, Loader2, LockKeyhole, Minus, Trash2 } from "../icons";
import { cn } from "@/lib/cn";
import { demos, frameUrl, readInputFiles, useBotDemos } from "@/lib/demo-recorder";
import { t } from "@/lib/i18n";
import { friendlyError } from "@/lib/plain-error";
import type { LocaleKey } from "@/locales";
import { askConfirm } from "./ConfirmDialog";
import { FormField } from "./ListRows";
import { GrokDialog, mdPrimaryCls, mdSecondaryCls, rowHintCls, smallButtonCls, textAreaCls, textFieldCls } from "./ui/GrokDialog";

const iconButton = "flex size-7 shrink-0 items-center justify-center rounded-md text-ink-secondary hover:bg-ink/6 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus disabled:cursor-default disabled:opacity-40";
const sectionTitle = "m-0 text-[13px] font-medium leading-[18px] text-ink";
const count = (key: "showOnce.actions" | "showOnce.review.framesSkipped" | "showOnce.run.byBot", n: number, more: Record<string, string | number> = {}) =>
  t(`${key}.${n === 1 ? "one" : "many"}` as LocaleKey, { count: n, ...more });

/** A check as a person reads it. */
export function checkLine(check: DemoCheck): string {
  if (check.kind === "text") return t("showOnce.check.text", { text: check.text });
  if (check.kind === "field") return t("showOnce.check.field", { name: check.name, value: check.value });
  if (check.kind === "title") return t("showOnce.check.title", { text: check.text });
  if (check.kind === "url") return t("showOnce.check.url", { text: check.text });
  return check.expect;
}

const KIND: Record<DemoBlank["kind"], LocaleKey> = { text: "showOnce.inputs.kind.text", number: "showOnce.inputs.kind.number", date: "showOnce.inputs.kind.date", choice: "showOnce.inputs.kind.choice", secret: "showOnce.inputs.kind.secret" };

function BlankRow({ blank, onRename, onFix }: { blank: DemoBlank; onRename: (to: string) => string | null; onFix: () => void }) {
  const [name, setName] = useState(blank.name);
  const [error, setError] = useState("");
  useEffect(() => { setName(blank.name); setError(""); }, [blank.name]);
  const commit = () => {
    const wanted = name.trim();
    if (wanted === blank.name) { setError(""); return; }
    const refused = onRename(wanted);
    setError(refused ?? "");
    if (refused) setName(blank.name);
  };
  return (
    <li data-demo-blank={blank.name} className="flex flex-col gap-1 rounded-[10px] bg-ink/4 px-3 py-2">
      <div className="flex items-center gap-2">
        <input
          value={name}
          aria-label={t("showOnce.inputs.rename", { name: blank.name })}
          spellCheck={false}
          autoCapitalize="off"
          onChange={(event) => setName(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); } }}
          className="h-7 w-40 min-w-0 rounded-md bg-ink/6 px-2 font-mono text-[12px] text-ink outline-none focus:bg-ink/10"
        />
        <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{blank.label}</span>
        <span className="shrink-0 text-[12px] text-ink-secondary">{t(KIND[blank.kind])}</span>
      </div>
      {blank.kind === "secret" ? (
        <p className="m-0 flex items-center gap-1.5 text-[12px] leading-4 text-ink-secondary"><LockKeyhole size={12} aria-hidden="true" />{t("showOnce.inputs.secret")}</p>
      ) : (
        <div className="flex items-center gap-2">
          <p className="m-0 min-w-0 flex-1 truncate text-[12px] leading-4 text-ink-secondary">{blank.example ? t("showOnce.inputs.example", { value: blank.example }) : ""}</p>
          {blank.example ? <button type="button" className={smallButtonCls} onClick={onFix}>{t("showOnce.inputs.fix")}</button> : null}
        </div>
      )}
      {error && <p role="alert" className="m-0 text-[12px] leading-4 text-danger">{error}</p>}
    </li>
  );
}

const PICTURE = { width: 176, height: 110, zoom: 0.45 } as const;

/** A step's picture, drawn in close on where it happened; the whole screen from the top when nothing says where. */
function StepPicture({ recordingId, step, frame, number }: { recordingId: string; step: DemoStep; frame: DemoFrame | undefined; number: number }) {
  const box = "relative shrink-0 overflow-hidden rounded-md bg-ink/6";
  const size = { width: PICTURE.width, height: PICTURE.height };
  if (!step.frame || !frame) return <div aria-hidden="true" style={size} className={cn(box, "flex items-center justify-center text-ink-tertiary")}><FileText size={16} /></div>;
  const scale = frame.scale ?? 1;
  const zoom = step.point ? PICTURE.zoom : PICTURE.width / frame.width;
  const within = (value: number, room: number) => Math.max(Math.min(0, room), Math.min(0, value));
  const left = step.point ? within(PICTURE.width / 2 - step.point.x * scale * zoom, PICTURE.width - frame.width * zoom) : 0;
  const top = step.point ? within(PICTURE.height / 2 - step.point.y * scale * zoom, PICTURE.height - frame.height * zoom) : 0;
  return (
    <div role="img" aria-label={t("showOnce.step.picture", { number })} style={{ ...size, backgroundImage: `url("${frameUrl(recordingId, step.frame)}")`, backgroundSize: `${frame.width * zoom}px ${frame.height * zoom}px`, backgroundPosition: `${left}px ${top}px` }} className={cn(box, "bg-no-repeat")}>
      {step.point ? <span aria-hidden="true" className="absolute size-6 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-accent bg-accent/15" style={{ left: left + step.point.x * scale * zoom, top: top + step.point.y * scale * zoom }} /> : null}
    </div>
  );
}

function StepRow({ recordingId, step, frame, index, total, dragging, over, onChange, onMove, onRemove, onDragStart, onDragOver, onDrop }: {
  recordingId: string; step: DemoStep; frame: DemoFrame | undefined; index: number; total: number; dragging: boolean; over: boolean;
  onChange: (patch: Partial<Pick<DemoStep, "title" | "goal">>) => void; onMove: (to: number) => void; onRemove: () => void;
  onDragStart: () => void; onDragOver: () => void; onDrop: () => void;
}) {
  const number = index + 1;
  return (
    <li
      data-demo-step={step.id}
      onDragOver={(event) => { event.preventDefault(); onDragOver(); }}
      onDrop={(event) => { event.preventDefault(); onDrop(); }}
      className={cn("flex items-start gap-3 rounded-[10px] px-2 py-2", over ? "bg-accent/15" : "bg-ink/4", dragging && "opacity-50")}
    >
      <button type="button" draggable onDragStart={(event) => { event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", step.id); onDragStart(); }} aria-label={t("showOnce.step.drag", { number })} title={t("showOnce.step.drag", { number })} className={cn(iconButton, "mt-4 cursor-grab active:cursor-grabbing")}>
        <GripVertical size={14} aria-hidden="true" />
      </button>
      <StepPicture recordingId={recordingId} step={step} frame={frame} number={number} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-center gap-2">
          <span aria-hidden="true" className="w-5 shrink-0 text-right text-[12px] tabular-nums text-ink-secondary">{number}</span>
          <input value={step.title} aria-label={t("showOnce.step.title", { number })} onChange={(event) => onChange({ title: event.target.value })} className={cn(textFieldCls, "h-7 font-medium")} />
        </div>
        <textarea value={step.goal} aria-label={t("showOnce.step.goal", { number })} rows={2} onChange={(event) => onChange({ goal: event.target.value })} className={cn(textAreaCls, "ml-7 w-auto")} />
        <p className="m-0 ml-7 flex items-start gap-1.5 text-[12px] leading-4 text-ink-secondary">
          <Check size={12} aria-hidden="true" className="mt-0.5 shrink-0" />
          <span className="min-w-0 break-words"><span className="text-ink">{t("showOnce.step.checkLabel")}</span> {checkLine(step.check)}</span>
        </p>
      </div>
      <div className="flex shrink-0 flex-col items-center">
        <button type="button" className={iconButton} disabled={index === 0} aria-label={t("showOnce.step.moveUp", { number })} title={t("showOnce.step.moveUp", { number })} onClick={() => onMove(index - 1)}><ArrowUp size={14} aria-hidden="true" /></button>
        <button type="button" className={iconButton} disabled={index === total - 1} aria-label={t("showOnce.step.moveDown", { number })} title={t("showOnce.step.moveDown", { number })} onClick={() => onMove(index + 1)}><ArrowDown size={14} aria-hidden="true" /></button>
        <button type="button" className={iconButton} disabled={total <= 1} aria-label={t("showOnce.step.remove", { number })} title={t("showOnce.step.remove", { number })} onClick={onRemove}><Trash2 size={14} aria-hidden="true" /></button>
      </div>
    </li>
  );
}

type Saving = "" | "skill" | "routine" | "run" | "delete";

/** One recording's steps, to read over, change and save. */
export function DemoReview({ recording, botName, holding, onClose }: { recording: DemoRecording; botName: string; holding: boolean; onClose: () => void }) {
  const [plan, setPlan] = useState<DemoPlan>(recording.plan!);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<Saving>("");
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [skillName, setSkillName] = useState(recording.skillName ?? "");
  const [routine, setRoutine] = useState<{ name: string; source: string } | null>(null);
  const [dragged, setDragged] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const frames = useMemo(() => new Map(recording.frames.map((frame) => [frame.id, frame])), [recording.frames]);

  const edit = (next: DemoPlan | { error: string }): string | null => {
    if ("error" in next) return next.error;
    setPlan(next);
    setDirty(true);
    setError("");
    return null;
  };
  /** A title or goal as it is typed: kept as written, and checked against the inputs when it is saved. */
  const write = (stepId: string, patch: Partial<Pick<DemoStep, "title" | "goal">>) => {
    setPlan((now) => ({ ...now, steps: now.steps.map((step) => (step.id === stepId ? { ...step, ...patch } : step)) }));
    setDirty(true);
  };
  const stored = async (): Promise<boolean> => {
    if (!dirty) return true;
    for (const step of plan.steps) {
      const checked = updateStep(plan, step.id, { title: step.title, goal: step.goal });
      if ("error" in checked) { setError(t("showOnce.review.stepProblem", { number: plan.steps.indexOf(step) + 1, problem: checked.error })); return false; }
    }
    if (!plan.title.trim()) { setError(t("showOnce.review.needsName")); return false; }
    const saved = await demos.savePlan(recording.id, plan);
    setPlan(saved.plan!);
    setDirty(false);
    return true;
  };
  const run = async (what: Saving, work: () => Promise<void>) => {
    setBusy(what);
    setError("");
    setNote("");
    try { await work(); } catch (cause) { setError(friendlyError(cause)); } finally { setBusy(""); }
  };

  const saveSkill = () => run("skill", async () => {
    if (!await stored()) return;
    const saved = await demos.saveSkill(recording.id, skillName);
    setSkillName(saved.skillName ?? "");
    setNote(t("showOnce.save.saved", { name: saved.skillName ?? "" }));
  });
  const saveRoutine = () => run("routine", async () => {
    if (!routine || !await stored()) return;
    await demos.saveRoutine(recording.id, routine.name, routine.source);
    setRoutine(null);
    setNote(t("showOnce.save.routineSaved"));
  });
  const replay = (files: File[]) => run("run", async () => {
    if (!await stored()) return;
    const { read, skipped } = await readInputFiles(files);
    if (!read.length) { setError(t("showOnce.run.nothingToRead")); return; }
    await demos.replay(recording, read);
    if (skipped.length) setNote(t("showOnce.run.skipped", { names: skipped.join(", ") }));
    else onClose();
  });
  const remove = () => run("delete", async () => {
    if (!await askConfirm({ title: t("showOnce.deleteTitle"), body: t("showOnce.deleteBody"), confirmLabel: t("common.delete"), tone: "danger" })) return;
    await demos.remove(recording);
    onClose();
  });

  const drop = (onto: string) => {
    if (dragged && dragged !== onto) edit(moveStep(plan, dragged, plan.steps.findIndex((step) => step.id === onto)));
    setDragged(null);
    setOver(null);
  };
  const working = busy !== "";

  return (
    <GrokDialog
      title={t("showOnce.review.title")}
      width={760}
      onClose={onClose}
      data-panel-modal="demo-review"
      footer={<>
        <button type="button" className={cn(mdSecondaryCls, "mr-auto")} disabled={working} onClick={() => void remove()}>{t("showOnce.delete")}</button>
        <input ref={picker} type="file" multiple hidden accept=".txt,.csv,.tsv,.json,.md,.eml,.log,.xml,.html,.yaml,.yml,text/*,application/json" onChange={(event) => { const files = [...(event.target.files ?? [])]; event.target.value = ""; if (files.length) void replay(files); }} />
        <button type="button" className={mdSecondaryCls} disabled={working || holding} title={holding ? t("showOnce.holdHint", { name: botName }) : undefined} onClick={() => picker.current?.click()}>{busy === "run" ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : null}{t("showOnce.run.choose")}</button>
        <button type="button" className={mdSecondaryCls} disabled={working} onClick={() => setRoutine((now) => now ?? { name: plan.title, source: "" })}>{t("showOnce.save.routine")}</button>
        <button type="button" className={mdPrimaryCls} disabled={working} onClick={() => void saveSkill()}>{busy === "skill" ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : null}{t("showOnce.save.skill")}</button>
      </>}
    >
      <div className="flex flex-col gap-5" data-demo-review={recording.id}>
        <div className="flex flex-col gap-2">
          <div className="grid grid-cols-[minmax(0,1fr)_200px] gap-3">
            <FormField label={t("showOnce.review.name")}>
              <input value={plan.title} onChange={(event) => { setPlan({ ...plan, title: event.target.value }); setDirty(true); }} className={textFieldCls} />
            </FormField>
            <FormField label={t("showOnce.save.skillName")}>
              <input value={skillName} placeholder={t("showOnce.save.skillNamePlaceholder")} spellCheck={false} autoCapitalize="off" onChange={(event) => setSkillName(event.target.value)} className={textFieldCls} />
            </FormField>
          </div>
          <p className={cn(rowHintCls, "m-0")}>
            {plan.compiledBy === "engine" ? t("showOnce.review.fromModel", { name: botName }) : t("showOnce.review.fromOutline")}
            {recording.accessibility === "none" ? ` ${t("showOnce.review.blind", { name: botName })}` : ""}
            {recording.framesSkipped > 0 ? ` ${count("showOnce.review.framesSkipped", recording.framesSkipped)}` : ""}
            {recording.truncated ? ` ${t("showOnce.review.truncated")}` : ""}
          </p>
        </div>

        <section aria-label={t("showOnce.inputs.title")} className="flex flex-col gap-2">
          <h3 className={sectionTitle}>{t("showOnce.inputs.title")}</h3>
          {plan.blanks.length ? <>
            <p className={cn(rowHintCls, "m-0")}>{t("showOnce.inputs.hint")}</p>
            <ul className="m-0 grid list-none grid-cols-1 gap-2 p-0 sm:grid-cols-2">
              {plan.blanks.map((blank) => (
                <BlankRow key={blank.name} blank={blank} onRename={(to) => edit(renameBlank(plan, blank.name, to))} onFix={() => { edit(fixBlank(plan, blank.name, blank.example ?? "")); }} />
              ))}
            </ul>
          </> : <p className={cn(rowHintCls, "m-0")}>{t("showOnce.inputs.none")}</p>}
        </section>

        <section aria-label={t("showOnce.steps.title")} className="flex flex-col gap-2">
          <h3 className={sectionTitle}>{t("showOnce.steps.title")}</h3>
          <p className={cn(rowHintCls, "m-0")}>{t("showOnce.steps.hint")}</p>
          <ol className="m-0 flex list-none flex-col gap-2 p-0" onDragEnd={() => { setDragged(null); setOver(null); }}>
            {plan.steps.map((step, index) => (
              <StepRow
                key={step.id}
                recordingId={recording.id}
                step={step}
                frame={step.frame ? frames.get(step.frame) : undefined}
                index={index}
                total={plan.steps.length}
                dragging={dragged === step.id}
                over={over === step.id && dragged !== null && dragged !== step.id}
                onChange={(patch) => write(step.id, patch)}
                onMove={(to) => { edit(moveStep(plan, step.id, to)); }}
                onRemove={() => { edit(removeStep(plan, step.id)); }}
                onDragStart={() => setDragged(step.id)}
                onDragOver={() => setOver(step.id)}
                onDrop={() => drop(step.id)}
              />
            ))}
          </ol>
        </section>

        {routine && (
          <form className="flex flex-col gap-2 rounded-[10px] bg-ink/4 p-3" onSubmit={(event) => { event.preventDefault(); void saveRoutine(); }}>
            <h3 className={sectionTitle}>{t("showOnce.save.routine")}</h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <FormField label={t("showOnce.save.routineName")}><input value={routine.name} onChange={(event) => setRoutine({ ...routine, name: event.target.value })} className={textFieldCls} /></FormField>
              <FormField label={t("showOnce.save.routineSource")}><input autoFocus value={routine.source} placeholder={t("showOnce.save.routineSourcePlaceholder")} onChange={(event) => setRoutine({ ...routine, source: event.target.value })} className={textFieldCls} /></FormField>
            </div>
            <p className={cn(rowHintCls, "m-0")}>{t("showOnce.save.routineNote")}</p>
            <div className="flex justify-end gap-2">
              <button type="button" className={mdSecondaryCls} onClick={() => setRoutine(null)}>{t("common.cancel")}</button>
              <button type="submit" className={mdPrimaryCls} disabled={working || !routine.source.trim()}>{t("showOnce.save.create")}</button>
            </div>
          </form>
        )}

        {note && <p role="status" className="m-0 flex items-center gap-1.5 text-[13px] leading-[18px] text-ink"><CircleCheck size={14} aria-hidden="true" className="shrink-0 text-accent-text" />{note}</p>}
        {error && <p role="alert" className="m-0 text-[13px] leading-[18px] text-danger">{error}</p>}
      </div>
    </GrokDialog>
  );
}

const ROW_STATUS: Record<DemoReplayRun["items"][number]["status"], LocaleKey> = { waiting: "showOnce.run.status.waiting", running: "showOnce.run.status.running", done: "showOnce.run.status.done", failed: "showOnce.run.status.failed", skipped: "showOnce.run.status.skipped" };

function RunRow({ item, botName }: { item: DemoReplayRun["items"][number]; botName: string }) {
  const icon: ReactNode = item.status === "done" ? <CircleCheck size={14} className="text-accent-text" />
    : item.status === "failed" ? <CircleAlert size={14} className="text-danger" />
    : item.status === "running" ? <Loader2 size={14} className="animate-spin text-ink" />
    : item.status === "skipped" ? <Minus size={14} className="text-ink-secondary" />
    : <CircleDashed size={14} className="text-ink-tertiary" />;
  const detail = item.status === "skipped" && item.missing.length ? t("showOnce.run.missing", { names: item.missing.join(", ") })
    : item.status === "failed" ? [item.step, item.note].filter(Boolean).join(": ")
    : item.status === "running" ? item.step ?? ""
    : item.byBot > 0 ? count("showOnce.run.byBot", item.byBot, { name: botName }) : "";
  return (
    <li data-demo-run-item={item.status} className="flex items-start gap-2 py-1">
      <span aria-hidden="true" className="mt-0.5 shrink-0">{icon}</span>
      <span className="w-48 shrink-0 truncate text-[12px] leading-[18px] text-ink" title={item.label}>{item.label}</span>
      <span className="sr-only">{t(ROW_STATUS[item.status])}</span>
      <span className={cn("min-w-0 flex-1 break-words text-[12px] leading-[18px]", item.status === "failed" ? "text-danger" : "text-ink-secondary")}>{detail}</span>
    </li>
  );
}

/** A replay as it goes: how far it is, what it is on, and each file's outcome on request. */
export function DemoRun({ run, botName, onDismiss }: { run: DemoReplayRun; botName: string; onDismiss: () => void }) {
  const [open, setOpen] = useState(false);
  const [stopping, setStopping] = useState(false);
  const total = run.items.length;
  const settled = run.items.filter((item) => item.status === "done" || item.status === "failed" || item.status === "skipped").length;
  const current = run.items.find((item) => item.status === "running");
  const running = run.status === "running";
  const failed = run.failed + run.items.filter((item) => item.status === "skipped" && item.missing.length > 0).length;
  const headline = running ? t("showOnce.run.progress", { done: Math.min(total, settled + (current ? 1 : 0)), total })
    : run.status === "stopped" ? t("showOnce.run.stopped", { done: run.done, total })
    : failed ? t("showOnce.run.doneWithFailed", { done: run.done, total, failed }) : t("showOnce.run.done", { done: run.done, total });
  return (
    <div data-demo-run={run.status} className="flex flex-col">
      <div className="flex min-h-9 items-center gap-2 px-3 py-1">
        {running ? <Loader2 size={14} className="shrink-0 animate-spin text-ink" aria-hidden="true" /> : failed || run.status === "stopped" ? <CircleAlert size={14} className="shrink-0 text-ink-secondary" aria-hidden="true" /> : <CircleCheck size={14} className="shrink-0 text-accent-text" aria-hidden="true" />}
        <span role="status" className="shrink-0 text-[12px] font-medium text-ink">{running ? t("showOnce.run.title") : ""}{running ? " · " : ""}{headline}</span>
        <span className="min-w-0 flex-1 truncate text-[12px] text-ink-secondary">{current ? [current.label, current.step].filter(Boolean).join(" · ") : ""}</span>
        <button type="button" className={smallButtonCls} aria-expanded={open} onClick={() => setOpen(!open)}>{open ? <ChevronUp size={12} aria-hidden="true" /> : <ChevronDown size={12} aria-hidden="true" />}{t(open ? "showOnce.run.hide" : "showOnce.run.details")}</button>
        {running
          ? <button type="button" className={smallButtonCls} disabled={stopping} onClick={() => { setStopping(true); void demos.stopReplay(run.recordingId).catch(() => {}).finally(() => setStopping(false)); }}>{t("showOnce.run.stop")}</button>
          : <button type="button" className={smallButtonCls} onClick={onDismiss}>{t("common.close")}</button>}
      </div>
      <div aria-hidden="true" className="h-0.5 bg-ink/6"><div className="h-full bg-accent transition-[width] duration-300 motion-reduce:transition-none" style={{ width: `${total ? (settled / total) * 100 : 0}%` }} /></div>
      {open && <ul className="m-0 max-h-56 list-none overflow-y-auto px-3 py-2 [scrollbar-width:thin]">{run.items.map((item) => <RunRow key={item.id} item={item} botName={botName} />)}</ul>}
    </div>
  );
}

const TAKE_TIMEOUT_MS = 12_000;

/**
 * Show it once, on one of a bot's screens: Record while the person holds it, the steps to review when they stop, and
 * the replay as it runs. `holding` says the person has taken control here; `onTake` takes it and keeps it, which Record
 * does first so the screen stays theirs for as long as they are showing the task. A change of `asked` starts a recording
 * from elsewhere, such as a menu.
 */
export function DemoRecorder({ bot, surface, holding, threadId, onTake, asked = 0 }: { bot: { id: string; name: string }; surface: DemoSurface; holding: boolean; threadId?: string; onTake?: () => void; asked?: number }) {
  const state = useBotDemos(bot.id);
  const [taking, setTaking] = useState(false);
  const heard = useRef(asked);
  const [reviewing, setReviewing] = useState<string | null>(null);
  const [listOpen, setListOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [dismissed, setDismissed] = useState<string | null>(null);

  const live = state.recordings.find((recording) => recording.status === "recording" || recording.status === "compiling");
  const ready = state.recordings.filter((recording) => recording.status === "ready" && recording.plan);
  const run = Object.values(state.runs).find((each) => each.id !== dismissed && ready.some((recording) => recording.id === each.recordingId));
  const review = reviewing ? ready.find((recording) => recording.id === reviewing) : undefined;
  const canRecord = state.surfaces[surface] && (holding || taking) && !live;

  const act = async (work: () => Promise<DemoRecording | void>): Promise<DemoRecording | void> => {
    setBusy(true);
    setError("");
    try { return await work(); } catch (cause) { setError(friendlyError(cause)); } finally { setBusy(false); }
  };
  const begin = () => {
    if (live || taking || !state.surfaces[surface]) return;
    setError("");
    onTake?.();
    setTaking(true);
  };
  useEffect(() => {
    if (!taking) return;
    if (holding) {
      setTaking(false);
      void act(() => demos.start(bot.id, surface, threadId));
      return;
    }
    const late = setTimeout(() => { setTaking(false); setError(t("showOnce.takeFailed")); }, TAKE_TIMEOUT_MS);
    return () => clearTimeout(late);
  }, [taking, holding]);
  useEffect(() => {
    if (asked === heard.current) return;
    heard.current = asked;
    begin();
  }, [asked]);
  const stop = async () => {
    const stopped = await act(() => demos.stop(bot.id));
    if (!stopped) return;
    if (stopped.status === "ready") setReviewing(stopped.id);
    else setError(stopped.error ? t("showOnce.failedWhy", { why: stopped.error }) : t("showOnce.failed"));
  };

  if (!state.loaded || (!state.surfaces[surface] && !ready.length && !live)) return null;
  if (!holding && !taking && !live && !run && !ready.length && !error) return null;

  return (
    <div data-demo-recorder={live?.status ?? (run ? "replay" : "idle")} className="shrink-0 border-b border-transparent bg-inset/60">
      {run ? <DemoRun run={run} botName={bot.name} onDismiss={() => setDismissed(run.id)} /> : (
        <div className="flex min-h-9 items-center gap-2 px-3 py-1">
          {live?.status === "recording" ? <>
            <span aria-hidden="true" className="size-2 shrink-0 animate-pulse rounded-full bg-danger motion-reduce:animate-none" />
            <span role="status" className="shrink-0 text-[12px] font-medium text-ink">{t("showOnce.recording")}</span>
            <span className="min-w-0 flex-1 truncate text-[12px] text-ink-secondary">{count("showOnce.actions", live.eventCount)}</span>
            <button type="button" className={smallButtonCls} disabled={busy} onClick={() => void act(() => demos.cancel(bot.id))}>{t("showOnce.discard")}</button>
            <button type="button" className={cn(smallButtonCls, "bg-ink text-app enabled:hover:bg-ink/85 disabled:bg-ink/15 disabled:text-ink/30")} disabled={busy} onClick={() => void stop()}>{t("showOnce.stop")}</button>
          </> : live ? <>
            <Loader2 size={14} className="shrink-0 animate-spin text-ink" aria-hidden="true" />
            <span role="status" className="min-w-0 flex-1 truncate text-[12px] text-ink">{t("showOnce.compiling")}</span>
          </> : <>
            {canRecord ? (
              <button type="button" data-demo-record className={smallButtonCls} disabled={busy || taking} title={t("showOnce.recordTitle", { name: bot.name })} onClick={begin}>
                {taking ? <Loader2 size={12} className="animate-spin" aria-hidden="true" /> : <span aria-hidden="true" className="size-2 rounded-full bg-danger" />}{t("showOnce.record")}
              </button>
            ) : null}
            <span className="min-w-0 flex-1 truncate text-[12px] text-ink-secondary">{canRecord ? t("showOnce.recordHint", { name: bot.name }) : ""}</span>
            {ready.length > 0 && (
              <button type="button" className={smallButtonCls} aria-expanded={listOpen} onClick={() => setListOpen(!listOpen)}>{t("showOnce.shown", { count: ready.length })}{listOpen ? <ChevronUp size={12} aria-hidden="true" /> : <ChevronDown size={12} aria-hidden="true" />}</button>
            )}
          </>}
        </div>
      )}
      {error && <p role="alert" className="m-0 px-3 pb-1.5 text-[12px] leading-4 text-danger">{error}</p>}
      {listOpen && !run && !live && ready.length > 0 && (
        <ul className="m-0 flex max-h-48 list-none flex-col overflow-y-auto px-2 pb-2 [scrollbar-width:thin]">
          {ready.map((recording) => (
            <li key={recording.id}>
              <button type="button" className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-ink/6 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus" onClick={() => { setReviewing(recording.id); setListOpen(false); }}>
                <span className="min-w-0 flex-1 truncate text-[12px] text-ink">{recording.plan!.title}</span>
                <span className="shrink-0 text-[12px] text-ink-secondary">{recording.skillName ? t("showOnce.savedAs", { name: recording.skillName }) : t("showOnce.notSaved")}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {review && <DemoReview key={review.id} recording={review} botName={bot.name} holding={holding} onClose={() => setReviewing(null)} />}
    </div>
  );
}
