import { Fragment, useEffect, useMemo, useRef, useState } from "react";

import { fixBlank, moveStep, removeStep, renameBlank, updateStep } from "../../shared/demo-plan";
import type { DemoBlank, DemoCheck, DemoFrame, DemoPlan, DemoRecording, DemoStep } from "../../shared/demo-recording";
import { ArrowDown, ArrowUp, Check, ChevronDown, CircleCheck, FileText, GripVertical, Loader2, LockKeyhole, Trash2 } from "../icons";
import { cn } from "@/lib/cn";
import { demos, frameUrl, readInputFiles } from "@/lib/demo-recorder";
import { t } from "@/lib/i18n";
import { friendlyError } from "@/lib/plain-error";
import type { LocaleKey } from "@/locales";
import { askConfirm } from "./ConfirmDialog";
import { FormField } from "./ListRows";
import { GrokDialog, mdPrimaryCls, mdSecondaryCls, rowHintCls, smallButtonCls, textAreaCls, textFieldCls } from "./ui/GrokDialog";

const iconButton = "flex size-7 shrink-0 items-center justify-center rounded-md text-ink-secondary hover:bg-ink/6 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus disabled:cursor-default disabled:opacity-40";
const sectionLabel = "m-0 text-[13px] font-normal leading-[18px] text-ink-secondary";
const tokenCls = "rounded-md bg-accent/12 px-1.5 py-0.5 font-mono text-[12px] leading-4 text-accent-text";
const cardCls = "flex flex-col rounded-[13px] outline-1 -outline-offset-1 outline-edge [outline-style:solid]";
const many = (key: "showOnce.review.framesSkipped" | "showOnce.review.count.steps" | "showOnce.review.count.inputs", n: number) => t(`${key}.${n === 1 ? "one" : "many"}` as LocaleKey, { count: n });

/** A check as a person reads it. */
export function checkLine(check: DemoCheck): string {
  if (check.kind === "text") return t("showOnce.check.text", { text: check.text });
  if (check.kind === "field") return t("showOnce.check.field", { name: check.name, value: check.value });
  if (check.kind === "title") return t("showOnce.check.title", { text: check.text });
  if (check.kind === "url") return t("showOnce.check.url", { text: check.text });
  return check.expect;
}

/** A goal as a sentence, with each input it names drawn as that input. */
function Sentence({ text }: { text: string }) {
  return <>{text.split(/(\{\{\w+\}\})/).map((part, index) => {
    const name = /^\{\{(\w+)\}\}$/.exec(part)?.[1];
    return name ? <span key={index} data-demo-token={name} className={tokenCls}>{name}</span> : <Fragment key={index}>{part}</Fragment>;
  })}</>;
}

const KIND: Record<DemoBlank["kind"], LocaleKey> = { text: "showOnce.inputs.kind.text", number: "showOnce.inputs.kind.number", date: "showOnce.inputs.kind.date", choice: "showOnce.inputs.kind.choice", secret: "showOnce.inputs.kind.secret" };

function BlankChip({ blank, open, onToggle, onRename, onFix }: { blank: DemoBlank; open: boolean; onToggle: () => void; onRename: (to: string) => string | null; onFix: () => void }) {
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
  const secret = blank.kind === "secret";
  return (
    <li data-demo-blank={blank.name} className={cn("flex min-w-0 flex-col gap-2", open && "basis-full rounded-[11px] bg-ink/4 p-2")}>
      <button type="button" aria-expanded={open} onClick={onToggle} className={cn("flex h-8 min-w-0 max-w-full items-center gap-2 rounded-[10px] pl-1 pr-3 text-left text-[13px] text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus", open ? "self-start" : "bg-ink/4 hover:bg-ink/8")}>
        <span className={tokenCls}>{blank.name}</span>
        {secret ? <LockKeyhole size={12} aria-hidden="true" className="shrink-0 text-ink-secondary" /> : null}
        <span className="min-w-0 truncate">{secret ? t("showOnce.inputs.secret") : blank.example ?? blank.label}</span>
      </button>
      {open && <>
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={name}
            aria-label={t("showOnce.inputs.rename", { name: blank.name })}
            spellCheck={false}
            autoCapitalize="off"
            onChange={(event) => setName(event.target.value)}
            onBlur={commit}
            onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); } }}
            className="h-7 w-44 min-w-0 rounded-md bg-menu px-2 font-mono text-[12px] text-ink outline-none focus:bg-ink/10"
          />
          <span className="min-w-0 flex-1 truncate text-[12px] text-ink-secondary">{t("showOnce.inputs.from", { label: blank.label, kind: t(KIND[blank.kind]) })}</span>
          {!secret && blank.example ? <button type="button" className={smallButtonCls} title={t("showOnce.inputs.fixHint", { value: blank.example })} onClick={onFix}>{t("showOnce.inputs.fix")}</button> : null}
        </div>
        {error && <p role="alert" className="m-0 text-[12px] leading-4 text-danger">{error}</p>}
      </>}
    </li>
  );
}

const PICTURE = { width: 176, height: 110, zoom: 0.45 } as const;

/** A step's picture, drawn in close on where it happened; the whole screen from the top when nothing says where. */
function StepPicture({ recordingId, step, frame, number }: { recordingId: string; step: DemoStep; frame: DemoFrame | undefined; number: number }) {
  const box = "relative shrink-0 overflow-hidden rounded-[9px] bg-ink/6";
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

function StepRow({ recordingId, step, frame, index, total, open, dragging, over, onToggle, onChange, onMove, onRemove, onDragStart, onDragOver, onDrop }: {
  recordingId: string; step: DemoStep; frame: DemoFrame | undefined; index: number; total: number; open: boolean; dragging: boolean; over: boolean; onToggle: () => void;
  onChange: (patch: Partial<Pick<DemoStep, "title" | "goal">>) => void; onMove: (to: number) => void; onRemove: () => void;
  onDragStart: () => void; onDragOver: () => void; onDrop: () => void;
}) {
  const number = index + 1;
  return (
    <li
      data-demo-step={step.id}
      onDragOver={(event) => { event.preventDefault(); onDragOver(); }}
      onDrop={(event) => { event.preventDefault(); onDrop(); }}
      className={cn("flex flex-col border-t border-ink/6 first:border-t-0", over && "bg-accent/12", dragging && "opacity-50")}
    >
      <div className="flex min-h-10 items-center gap-2">
        <span aria-hidden="true" className="w-5 shrink-0 font-mono text-[12px] tabular-nums text-ink-secondary">{number}</span>
        <button type="button" aria-expanded={open} aria-label={t("showOnce.step.open", { number, title: step.title })} onClick={onToggle} className="flex min-w-0 flex-1 items-center gap-2 rounded-md py-2 text-left text-[14px] leading-5 text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus">
          <span className="min-w-0 flex-1 break-words"><Sentence text={step.goal || step.title} /></span>
          <ChevronDown size={14} aria-hidden="true" className={cn("shrink-0 text-ink-tertiary transition-transform motion-reduce:transition-none", open && "rotate-180")} />
        </button>
        <button type="button" draggable onDragStart={(event) => { event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", step.id); onDragStart(); }} aria-label={t("showOnce.step.drag", { number })} title={t("showOnce.step.drag", { number })} className={cn(iconButton, "cursor-grab active:cursor-grabbing")}>
          <GripVertical size={14} aria-hidden="true" />
        </button>
      </div>
      {open && (
        <div className="flex flex-wrap items-start gap-3 pb-3 pl-7">
          <StepPicture recordingId={recordingId} step={step} frame={frame} number={number} />
          <div className="flex min-w-48 flex-1 flex-col gap-1.5">
            <input value={step.title} aria-label={t("showOnce.step.title", { number })} onChange={(event) => onChange({ title: event.target.value })} className={cn(textFieldCls, "h-7 font-medium")} />
            <textarea value={step.goal} aria-label={t("showOnce.step.goal", { number })} rows={2} onChange={(event) => onChange({ goal: event.target.value })} className={textAreaCls} />
            <p className="m-0 flex items-start gap-1.5 text-[12px] leading-4 text-ink-secondary">
              <Check size={12} aria-hidden="true" className="mt-0.5 shrink-0" />
              <span className="min-w-0 break-words"><span className="text-ink">{t("showOnce.step.checkLabel")}</span> {checkLine(step.check)}</span>
            </p>
            <div className="flex items-center gap-1">
              <button type="button" className={iconButton} disabled={index === 0} aria-label={t("showOnce.step.moveUp", { number })} title={t("showOnce.step.moveUp", { number })} onClick={() => onMove(index - 1)}><ArrowUp size={14} aria-hidden="true" /></button>
              <button type="button" className={iconButton} disabled={index === total - 1} aria-label={t("showOnce.step.moveDown", { number })} title={t("showOnce.step.moveDown", { number })} onClick={() => onMove(index + 1)}><ArrowDown size={14} aria-hidden="true" /></button>
              <button type="button" className={iconButton} disabled={total <= 1} aria-label={t("showOnce.step.remove", { number })} title={t("showOnce.step.remove", { number })} onClick={onRemove}><Trash2 size={14} aria-hidden="true" /></button>
            </div>
          </div>
        </div>
      )}
    </li>
  );
}

type Saving = "" | "skill" | "routine" | "run" | "delete";

/**
 * One recording's steps, to read over, change and save. `named` is what the person called the task before they showed
 * it. Saving is offered only while there is something to save, and a routine only until this task has one.
 */
export function DemoReview({ recording, botName, holding, named = "", onClose }: { recording: DemoRecording; botName: string; holding: boolean; named?: string; onClose: () => void }) {
  const renamed = Boolean(named.trim()) && !recording.skillName && named.trim() !== recording.plan!.title;
  const [plan, setPlan] = useState<DemoPlan>(() => (renamed ? { ...recording.plan!, title: named.trim() } : recording.plan!));
  const [dirty, setDirty] = useState(renamed);
  const [busy, setBusy] = useState<Saving>("");
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [openStep, setOpenStep] = useState<string | null>(null);
  const [openBlank, setOpenBlank] = useState<string | null>(null);
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
    setNote("");
    return null;
  };
  /** A title or goal as it is typed: kept as written, and checked against the inputs when it is saved. */
  const write = (stepId: string, patch: Partial<Pick<DemoStep, "title" | "goal">>) => {
    setPlan((now) => ({ ...now, steps: now.steps.map((step) => (step.id === stepId ? { ...step, ...patch } : step)) }));
    setDirty(true);
    setNote("");
  };
  const stored = async (): Promise<boolean> => {
    if (!dirty) return true;
    for (const step of plan.steps) {
      const checked = updateStep(plan, step.id, { title: step.title, goal: step.goal });
      if ("error" in checked) { setError(t("showOnce.review.stepProblem", { number: plan.steps.indexOf(step) + 1, problem: checked.error })); setOpenStep(step.id); return false; }
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
    const saved = await demos.saveSkill(recording.id, "");
    setNote(t("showOnce.save.saved", { name: saved.skillName ?? "", bot: botName }));
  });
  const saveRoutine = () => run("routine", async () => {
    if (!routine || recording.routineId || !await stored()) return;
    await demos.saveRoutine(recording.id, routine.name, routine.source);
    setRoutine(null);
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
  const saved = Boolean(recording.skillName) && !dirty;
  const state = saved ? t("showOnce.save.state.saved", { name: recording.skillName ?? "" }) : recording.skillName ? t("showOnce.save.state.changed") : t("showOnce.notSaved");
  const facts = [
    many("showOnce.review.count.steps", plan.steps.length),
    many("showOnce.review.count.inputs", plan.blanks.length),
    plan.compiledBy === "engine" ? t("showOnce.review.fromModel", { name: botName }) : t("showOnce.review.fromOutline"),
  ].join(" · ");
  const cautions = [
    recording.accessibility === "none" ? t("showOnce.review.blind", { name: botName }) : "",
    recording.framesSkipped > 0 ? many("showOnce.review.framesSkipped", recording.framesSkipped) : "",
    recording.truncated ? t("showOnce.review.truncated") : "",
  ].filter(Boolean);

  return (
    <GrokDialog
      title={t("showOnce.review.title", { name: botName })}
      width={600}
      onClose={onClose}
      data-panel-modal="demo-review"
      footer={<>
        <button type="button" className={cn(mdSecondaryCls, "mr-auto")} disabled={working} onClick={() => void remove()}>{t("showOnce.delete")}</button>
        <span data-demo-save-state={saved ? "saved" : "unsaved"} className="min-w-0 truncate text-[12px] text-ink-secondary">{state}</span>
        <button type="button" data-demo-save className={mdPrimaryCls} disabled={working || saved} onClick={() => void saveSkill()}>
          {busy === "skill" ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : null}{saved ? t("showOnce.save.done") : recording.skillName ? t("showOnce.save.changes") : t("showOnce.save.skill")}
        </button>
      </>}
    >
      <div className="flex flex-col gap-5" data-demo-review={recording.id}>
        <div className="flex flex-col gap-1.5">
          <input value={plan.title} aria-label={t("showOnce.review.name")} placeholder={t("showOnce.review.name")} onChange={(event) => { setPlan({ ...plan, title: event.target.value }); setDirty(true); setNote(""); }} className="-mx-1.5 block h-9 min-w-0 rounded-[9px] bg-transparent px-1.5 text-[20px] font-semibold leading-7 tracking-[-0.015em] text-ink outline-none hover:bg-ink/4 focus:bg-ink/6" />
          <p className={cn(rowHintCls, "m-0")}>{facts}</p>
          {cautions.map((line) => <p key={line} className="m-0 rounded-[9px] bg-warning/12 px-2.5 py-1.5 text-[12px] leading-[17px] text-ink">{line}</p>)}
        </div>

        <section aria-label={t("showOnce.inputs.title")} className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between gap-3">
            <h3 className={sectionLabel}>{t("showOnce.inputs.title")}</h3>
            {plan.blanks.length ? <span className="text-[12px] text-ink-tertiary">{t("showOnce.inputs.hint")}</span> : null}
          </div>
          {plan.blanks.length ? (
            <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
              {plan.blanks.map((blank) => (
                <BlankChip key={blank.name} blank={blank} open={openBlank === blank.name} onToggle={() => setOpenBlank(openBlank === blank.name ? null : blank.name)}
                  onRename={(to) => { const refused = edit(renameBlank(plan, blank.name, to)); if (!refused) setOpenBlank(to); return refused; }}
                  onFix={() => { edit(fixBlank(plan, blank.name, blank.example ?? "")); setOpenBlank(null); }} />
              ))}
            </ul>
          ) : <p className={cn(rowHintCls, "m-0")}>{t("showOnce.inputs.none")}</p>}
        </section>

        <section aria-label={t("showOnce.steps.title")} className="flex flex-col gap-1">
          <div className="flex items-baseline justify-between gap-3">
            <h3 className={sectionLabel}>{t("showOnce.steps.title")}</h3>
            <span className="text-[12px] text-ink-tertiary">{t("showOnce.steps.hint")}</span>
          </div>
          <ol className="m-0 flex list-none flex-col p-0" onDragEnd={() => { setDragged(null); setOver(null); }}>
            {plan.steps.map((step, index) => (
              <StepRow
                key={step.id}
                recordingId={recording.id}
                step={step}
                frame={step.frame ? frames.get(step.frame) : undefined}
                index={index}
                total={plan.steps.length}
                open={openStep === step.id}
                dragging={dragged === step.id}
                over={over === step.id && dragged !== null && dragged !== step.id}
                onToggle={() => setOpenStep(openStep === step.id ? null : step.id)}
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

        <section aria-label={t("showOnce.again.title")} className="flex flex-col gap-2">
          <h3 className={sectionLabel}>{t("showOnce.again.title")}</h3>
          <div className={cardCls}>
            <div className="flex items-center gap-3 px-3.5 py-3">
              <div className="min-w-0 flex-1">
                <p className="m-0 text-[13px] font-medium leading-[18px] text-ink">{t("showOnce.run.choose")}</p>
                <p className={cn(rowHintCls, "m-0")}>{holding ? t("showOnce.holdHint", { name: botName }) : t("showOnce.run.chooseHint")}</p>
              </div>
              <input ref={picker} type="file" multiple hidden accept=".txt,.csv,.tsv,.json,.md,.eml,.log,.xml,.html,.yaml,.yml,text/*,application/json" onChange={(event) => { const files = [...(event.target.files ?? [])]; event.target.value = ""; if (files.length) void replay(files); }} />
              <button type="button" data-demo-run-choose className={mdSecondaryCls} disabled={working || holding} onClick={() => picker.current?.click()}>{busy === "run" ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : null}{t("showOnce.run.pick")}</button>
            </div>
            <div data-demo-routine={recording.routineId ? "added" : routine ? "form" : "none"} className="flex flex-col gap-2 border-t border-ink/6 px-3.5 py-3">
              {recording.routineId ? (
                <div className="flex items-start gap-2">
                  <CircleCheck size={14} aria-hidden="true" className="mt-0.5 shrink-0 text-success" />
                  <div className="min-w-0 flex-1">
                    <p className="m-0 text-[13px] font-medium leading-[18px] text-ink">{t("showOnce.routine.added")}</p>
                    <p className={cn(rowHintCls, "m-0")}>{t("showOnce.routine.addedHint", { name: botName })}</p>
                  </div>
                </div>
              ) : routine ? (
                <form className="flex flex-col gap-2" onSubmit={(event) => { event.preventDefault(); void saveRoutine(); }}>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <FormField label={t("showOnce.save.routineName")}><input value={routine.name} onChange={(event) => setRoutine({ ...routine, name: event.target.value })} className={textFieldCls} /></FormField>
                    <FormField label={t("showOnce.save.routineSource")}><input autoFocus value={routine.source} placeholder={t("showOnce.save.routineSourcePlaceholder")} onChange={(event) => setRoutine({ ...routine, source: event.target.value })} className={textFieldCls} /></FormField>
                  </div>
                  <p className={cn(rowHintCls, "m-0")}>{t("showOnce.save.routineNote")}</p>
                  <div className="flex justify-end gap-2">
                    <button type="button" className={mdSecondaryCls} onClick={() => setRoutine(null)}>{t("common.cancel")}</button>
                    <button type="submit" className={mdPrimaryCls} disabled={working || !routine.source.trim()}>{busy === "routine" ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : null}{t("showOnce.save.create")}</button>
                  </div>
                </form>
              ) : (
                <div className="flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="m-0 text-[13px] font-medium leading-[18px] text-ink">{t("showOnce.routine.title")}</p>
                    <p className={cn(rowHintCls, "m-0")}>{t("showOnce.routine.hint")}</p>
                  </div>
                  <button type="button" className={mdSecondaryCls} disabled={working} onClick={() => setRoutine({ name: plan.title, source: "" })}>{t("showOnce.save.routine")}</button>
                </div>
              )}
            </div>
          </div>
        </section>

        {note && <p role="status" className="m-0 flex items-center gap-1.5 text-[13px] leading-[18px] text-ink"><CircleCheck size={14} aria-hidden="true" className="shrink-0 text-success" />{note}</p>}
        {error && <p role="alert" className="m-0 text-[13px] leading-[18px] text-danger">{error}</p>}
      </div>
    </GrokDialog>
  );
}
