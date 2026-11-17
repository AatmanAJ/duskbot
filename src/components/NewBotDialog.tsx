import { ModalLayer } from "./ui/ModalLayer";
import { useEffect, useRef, useState } from "react";
import { NavRow } from "./ListRows";
import { Loader2, Plus, Trash2, X } from "../icons";
import { api, ScopedStore, useDispatch, type Action, type AppState } from "@/state/store";
import { BotCreationDraft, EMPTY_BOT_DEFAULTS } from "@/lib/bot-creation-draft";
import { preparedBotTemplate } from "@/lib/create-configured-bot";
import { BOT_ROLES, roleProfilePatch } from "@/lib/bot-roles";
import { readyBot } from "@/lib/ready-bots";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { startingTemplate, type BotDefaultsAnswer } from "@/lib/new-bot";
import type { Routine } from "@/lib/routines";
import { IdentitySection } from "./bot-settings/IdentitySection";
import { SoulSection } from "./bot-settings/SoulSection";
import { SkillsSection } from "./bot-settings/SkillsSection";
import { AccessSection } from "./bot-settings/AccessSection";
import { PermissionsSection } from "./bot-settings/PermissionsSection";
import { VoiceSection } from "./bot-settings/VoiceSection";
import { useBotSettingsDerived } from "./bot-settings/useBotSettingsDerived";
import { BotEditorContext } from "./bot-settings/BotEditorContext";
import { inputCls } from "./bot-settings/field";
import { RoutineForm } from "./routines/RoutineForm";
import { SharePresetDialog } from "./SharePresetDialog";
import { Select } from "./Select";
import { formCloseCls, formFooterCls, formHeaderCls, formTitleCls, mdPrimaryCls, mdSecondaryCls, rowButtonCls } from "./ui/GrokDialog";
import { friendlyError } from "@/lib/plain-error";

const SECTIONS = ["Identity", "Soul", "Skills", "Memory", "Routines", "Access", "Permissions", "Voice & alerts"] as const;
type Section = typeof SECTIONS[number];
const SECTION_KEYS: Record<Section, LocaleKey> = {
  Identity: "botSettings.sections.identity", Soul: "botSettings.sections.soul", Skills: "botSettings.sections.skills",
  Memory: "botSettings.sections.memory", Routines: "botSettings.sections.routines", Access: "botSettings.sections.access",
  Permissions: "botSettings.sections.permissions", "Voice & alerts": "botSettings.sections.voice",
};

/** The bot editor over the New bot defaults, saved as the template every new bot starts from. Bots themselves are made
 * by Create New Bot (CreateBotDialog). */
export function BotDefaultsDialog({ onClose }: { onClose: () => void }) {
  const parentDispatch = useDispatch();
  const [, render] = useState(0);
  const [draft, setDraft] = useState(() => new BotCreationDraft(EMPTY_BOT_DEFAULTS, () => render(value => value + 1)));
  const [active, setActive] = useState<Section>("Identity");
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const alive = useRef(true);
  const [error, setError] = useState("");
  const dialog = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    let cancelled = false;
    void api<BotDefaultsAnswer>("/api/bot-defaults")
      .then(result => {
        if (cancelled) return;
        setDraft(new BotCreationDraft(startingTemplate(result, false), () => render(value => value + 1)));
        setReady(true);
      }).catch(cause => { if (!cancelled) setError(friendlyError(cause)); });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => () => draft.dispose(), [draft]);
  // Disabling the focused Save button drops focus to the page in Chromium.
  useEffect(() => { if (saving) dialog.current?.focus(); }, [saving]);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      const root = dialog.current;
      if (!root || (event.target instanceof Node && !root.contains(event.target))) return;
      const nested = root.querySelector<HTMLElement>('[role="dialog"], [role="alertdialog"]');
      if (nested && nested.getClientRects().length) return;
      if (event.key === "Escape") { event.preventDefault(); closeRef.current(); }
      if (event.key !== "Tab") return;
      const controls = [...root.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex="0"]')]
        .filter(control => control.getClientRects().length && !control.closest("[hidden],fieldset:disabled"));
      const first = controls[0]; const last = controls.at(-1);
      if (!first || !last) { event.preventDefault(); root.focus(); return; }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === root)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === root)) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); if (previous?.isConnected) previous.focus(); };
  }, []);
  const save = async () => {
    if (!ready || savingRef.current) return;
    savingRef.current = true; setSaving(true); setError("");
    try {
      await api("/api/config", { method: "PATCH", body: JSON.stringify({ newBotDefaults: await preparedBotTemplate(draft) }) });
      savingRef.current = false; if (alive.current) closeRef.current();
    } catch (cause) { if (alive.current) setError(friendlyError(cause)); }
    finally {
      savingRef.current = false;
      if (alive.current) setSaving(false);
    }
  };
  const bot = draft.bot;
  const derive = (state: AppState): AppState => ({ ...state, bots: [bot, ...state.bots], routines: draft.routines, routineRuns: [], routinesLoadState: "ready" });
  const draftActions = {
    flushBotPatches: async () => bot,
    dispatch: (action: Action) => {
      if (action.type === "updateBot" && action.botId === draft.id) draft.patch(action.patch);
      else if (action.type === "setModel" && action.botId === draft.id) {
        draft.setModel(action.selection);
        if (action.resetApprovalToAsk) draft.patch({ approvalMode: "ask" });
      } else if (action.type === "routinePatched") {}
      else if (action.type === "toggleSettings") {}
      else parentDispatch(action);
    },
  };
  const title = t("newBot.defaults");
  return <ModalLayer><div className="fixed inset-0 z-[70] flex items-center justify-center p-3 sm:p-4">
    <div aria-hidden="true" className="ui-dialog-scrim pointer-events-none absolute inset-0" />
    <div ref={dialog} role="dialog" aria-modal="true" aria-label={title} aria-busy={saving} tabIndex={-1}
      className="relative flex h-[min(700px,94dvh)] w-full max-w-[900px] flex-col overflow-hidden rounded-[14px] border border-transparent bg-app text-[13px] font-[425] leading-[18px] text-ink outline-none focus-visible:outline-none!">
      <div className={formHeaderCls}>
        <h2 className={formTitleCls}>{title}</h2>
        <button type="button" onClick={() => closeRef.current()} aria-label={t("common.close")}
          className={cn(formCloseCls, "disabled:opacity-40")}><X size={16} className="pointer-events-none" /></button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
        <nav aria-label={t("newBot.sections")} className="flex shrink-0 gap-0.5 overflow-x-auto border-b border-transparent px-3 py-2 sm:w-44 sm:flex-col sm:border-b-0 sm:border-r">
          {SECTIONS.map(label => <button key={label} type="button" onClick={() => setActive(label)} aria-current={active === label ? "page" : undefined}
            className={cn("flex h-8 shrink-0 cursor-pointer items-center rounded-[8px] px-[9px] text-left text-[13px] leading-[18px] tracking-[0.195px] text-ink focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus", active === label ? "bg-ink/6" : "hover:bg-ink/[0.035]")}>{t(SECTION_KEYS[label])}</button>)}
        </nav>
        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto px-4 py-3 sm:px-6 sm:py-4">
          {!ready && !error && <div role="status" className="flex items-center gap-2 text-[13px] leading-[18px] text-ink/68"><Loader2 size={14} className="animate-spin" />{t("newBot.loading")}</div>}
          {ready && <fieldset disabled={saving} className="min-w-0">
            <ScopedStore derive={derive} actions={draftActions}><BotEditorContext.Provider value={{ request: draft.request, draft: true, uploadAvatar: draft.uploadAvatar }}>
              <DraftSection active={active} draft={draft} />
            </BotEditorContext.Provider></ScopedStore>
          </fieldset>}
        </div>
      </div>
      {error && <p role="alert" className="m-0 max-h-24 shrink-0 overflow-y-auto px-4 pt-2.5 text-[12px] leading-4 text-danger">{error}</p>}
      <div className={formFooterCls}>
        <button type="button" onClick={() => closeRef.current()} className={mdSecondaryCls}>{t("common.cancel")}</button>
        <button type="button" disabled={!ready || saving} onClick={() => void save()}
          className={cn(mdPrimaryCls, "gap-1.5")}>
          {saving && <Loader2 size={14} className="animate-spin" />}{t("newBot.saveDefaults")}
        </button>
      </div>
    </div>
  </div></ModalLayer>;
}

function DraftSection({ active, draft }: { active: Section; draft: BotCreationDraft }) {
  const bot = draft.bot;
  const derived = useBotSettingsDerived(bot);
  if (active === "Identity") return <div className="space-y-4">
    <StartingRole draft={draft} />
    <IdentitySection bot={bot} patch={derived.patch} activeState={derived.activeState} mascotMotion={null} namePlaceholder={t("newBot.randomName")} />
  </div>;
  if (active === "Soul") return <SoulSection bot={bot} patch={derived.patch} />;
  if (active === "Skills") return <SkillsSection bot={bot} />;
  if (active === "Memory") return <DraftMemory draft={draft} />;
  if (active === "Routines") return <DraftRoutines draft={draft} />;
  if (active === "Access") return <AccessSection bot={bot} derived={derived} />;
  if (active === "Permissions") return <PermissionsSection bot={bot} derived={derived} />;
  return <VoiceSection bot={bot} derived={derived} />;
}

function StartingRole({ draft }: { draft: BotCreationDraft }) {
  const choose = (value: string) => {
    const role = BOT_ROLES.find(role => role.id === value);
    draft.chooseRole(role?.id);
    const look = role && readyBot(role.id)?.look;
    if (role) draft.patch({ ...roleProfilePatch(role), ...look });
  };
  return <label className="block text-[13px] text-ink-secondary">{t("newBot.startingRole")}
    <Select size="lg" className="mt-1.5 w-full" value={draft.role ?? ""} onChange={event => choose(event.target.value)}>
      <option value="">{t("newBot.customSettings")}</option>
      {BOT_ROLES.map(role => <option key={role.id} value={role.id}>{role.title}</option>)}
    </Select>
  </label>;
}

function DraftMemory({ draft }: { draft: BotCreationDraft }) {
  const [path, setPath] = useState("MEMORY.md");
  const [name, setName] = useState("");
  return <div className="space-y-3">
    <Select size="lg" className="w-full" aria-label={t("memory.fileLabel", { path })} value={path} onChange={event => setPath(event.target.value)}>
      {[...new Set(["MEMORY.md", ...Object.keys(draft.template.memory)])].map(file => <option key={file}>{file}</option>)}
    </Select>
    <textarea className={cn(inputCls, "min-h-72 font-mono")} aria-label={t("memory.contents")} value={draft.template.memory[path] ?? ""} onChange={event => draft.setMemory(path, event.target.value)} />
    <div className="flex gap-2"><input className={inputCls} aria-label={t("memory.newTopicLabel")} placeholder={t("memory.newTopicLabel")} value={name} onChange={event => setName(event.target.value)} />
      <button type="button" aria-label={t("memory.addTopic")} disabled={!/^[a-zA-Z0-9_-]+$/.test(name)} className={cn(rowButtonCls, "h-9 disabled:opacity-40")} onClick={() => { const next = `memory/${name}.md`; if (!(next in draft.template.memory)) draft.setMemory(next, ""); setPath(next); setName(""); }}><Plus size={16} /></button>
      {path !== "MEMORY.md" && <button type="button" aria-label={t("memory.removeTopic")} className={cn(rowButtonCls, "h-9")} onClick={() => { draft.setMemory(path, null); setPath("MEMORY.md"); }}><Trash2 size={16} /></button>}
    </div>
  </div>;
}

function DraftRoutines({ draft }: { draft: BotCreationDraft }) {
  const [editing, setEditing] = useState<Routine | "new" | null>(null);
  return <div className="space-y-3">
    <button type="button" className={rowButtonCls} onClick={() => setEditing("new")}>{t("computer.routines.create")}</button>
    {draft.routines.map(routine => <div key={routine.id} className="flex items-center gap-2 rounded-[10px] px-2 py-1.5 hover:bg-ink/[0.035]">
      <button type="button" className="min-w-0 flex-1 text-left text-[13px]" onClick={() => setEditing(routine)}>{routine.name}</button>
      <label className="flex items-center gap-1.5 text-[12px] text-ink-secondary"><input type="checkbox" checked={routine.enabled} onChange={event => draft.setRoutineEnabled(routine.id, event.target.checked)} />{t("newBot.enabled")}</label>
      <button type="button" aria-label={t("newBot.removeRoutine", { name: routine.name })} onClick={() => draft.removeRoutine(routine.id)} className="flex size-7 cursor-pointer items-center justify-center rounded-full text-ink/68 hover:bg-ink/6 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus"><Trash2 size={15} /></button>
    </div>)}
    {editing && <RoutineForm key={editing === "new" ? "new" : editing.id} bot={draft.bot} routine={editing === "new" ? undefined : editing} onDone={() => setEditing(null)} />}
  </div>;
}

export function DefaultBotSettings() {
  const [open, setOpen] = useState(false);
  const [sharing, setSharing] = useState(false);
  return <>
    <NavRow data-settings-open="bot-defaults" title={t("newBot.defaults")} value={t("newBot.edit")} onClick={() => setOpen(true)} />
    <NavRow data-settings-open="share-preset" drill={false} title={t("newBot.sharePreset")} onClick={() => setSharing(true)} />
    {open && <BotDefaultsDialog onClose={() => setOpen(false)} />}
    {sharing && <SharePresetDialog onClose={() => setSharing(false)} />}
  </>;
}
