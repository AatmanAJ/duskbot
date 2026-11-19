import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { AudioLines, Camera, Check, GraduationCap, Images, ListChecks, Paperclip, Phone, Plus, Target, X } from "../icons";
import { approvalModeFor } from "../../shared/approval-mode";
import {
  approvalModeOptions,
  approvalModeOptionsFor,
  approvalModeSelectionRequiresLocalDesktop,
  shownApprovalMode,
  simpleApprovalName,
} from "@/lib/approval-mode-options";
import { CALL_MODES, effectiveCallMode, useCallMode } from "@/lib/call-mode";
import { callCapabilityHelp } from "@/lib/call-capability";
import { serverListeningReady, listensHere, speechBridge } from "@/lib/speech";
import { requestCallStart } from "@/lib/call-start-request";
import { useOnCall } from "@/lib/call";
import { isLiveCallRunning, useLiveMedia } from "@/lib/live-call-media";
import { useStore } from "@/state/store";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { useDesktopCapabilities } from "./DesktopCapabilities";
import { liveLineHeldElsewhere } from "./LiveCallBar";
import { useMenuMotion } from "./MenuMotion";
import { nextMenuIndex, SidebarPopoverMenu, type SidebarMenuItem } from "./SidebarPopoverMenu";
import type { ApprovalChoice } from "./thread-approval";
import type { AttachChoices } from "./ComposerFilePickers";
import { SIMPLE_CONTROL } from "./composer-simple";
import { Icon } from "./Icon";

/** Finish together: the room (or, `solo`, the one bot) keeps working until the goal is done. A quiet neutral pill, like
 * the approval chip beside it. `compact` is Simple mode's chip, shown only while the mode is on: its name and a × that
 * turns it off. */
const GOAL_FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus";

export function GoalToggle({ on, onToggle, solo = false, compact = false }: { on: boolean; onToggle: () => void; solo?: boolean; compact?: boolean }) {
  if (compact) {
    const off = t(solo ? "composer.goal.offSolo" : "composer.goal.off");
    return (
      <button
        type="button"
        data-goal-chip
        aria-label={off}
        title={off}
        onClick={onToggle}
        className={cn("group/goal flex h-7 items-center gap-1.5 whitespace-nowrap rounded-full bg-ink/[0.06] ps-2.5 pe-2 text-[13px] text-ink-secondary transition-colors hover:bg-ink/[0.11] hover:text-ink", GOAL_FOCUS)}
      >
        <Target size={14} aria-hidden="true" />
        {t(solo ? "composer.goal.soloAria" : "composer.goal.aria")}
        <X size={12} aria-hidden="true" className="text-ink-tertiary group-hover/goal:text-ink" />
      </button>
    );
  }
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={t(solo ? "composer.goal.soloAria" : "composer.goal.aria")}
      title={t(solo ? "composer.goal.soloTitle" : "composer.goal.title")}
      onClick={onToggle}
      className={cn(
        "flex h-8 items-center gap-1.5 whitespace-nowrap rounded-full px-3 text-[13px] transition-colors",
        on ? "bg-ink/[0.11] text-ink" : "bg-ink/[0.06] text-ink-secondary hover:bg-ink/[0.11] hover:text-ink",
        GOAL_FOCUS,
      )}
    >
      <Target size={14} aria-hidden="true" />
      {on ? "/goal" : t("composer.goal.chip")}
    </button>
  );
}

const check = <Check size={15} className="shrink-0 text-accent" aria-hidden="true" />;

/** The thread's approval level: the level shown and its menu, the levels named as the bot panel names them. */
function approvalMenu(choice: ApprovalChoice) {
  const trusted = choice.trustedModesAvailable ?? true;
  const mode = shownApprovalMode(choice.driverKind, approvalModeFor({ approvalMode: choice.approvalMode, autoApprove: choice.autoApprove }));
  const all = approvalModeOptions();
  const shown = approvalModeOptionsFor(choice.driverKind).find((option) => option.mode === mode)
    ?? all.find((option) => option.mode === mode)
    ?? all[0];
  const name = (option: typeof shown) => simpleApprovalName(option.mode, choice.driverKind);
  const current = { ...shown, label: name(shown), chip: name(shown) };
  const localOnly = approvalModeSelectionRequiresLocalDesktop(mode, trusted);
  return {
    current,
    note: localOnly ? t("approvalMode.customLocalOnlyDot") : choice.busy ? t("approvalMode.whileWorking") : undefined,
    items: [
      ...approvalModeOptionsFor(choice.driverKind, trusted).map((option): SidebarMenuItem => {
        const Icon = option.Icon;
        return {
          key: `approval:${option.mode}`,
          label: name(option),
          note: option.description,
          icon: <Icon size={16} />,
          active: option.mode === mode,
          trailing: option.mode === mode ? check : undefined,
          disabled: localOnly,
          onSelect: () => choice.onSelect(option.mode),
        };
      }),
      ...(choice.onManageCommandAllowlist ? [{
        key: "approval:allowlist",
        separatorBefore: true,
        label: t("commandAllowlist.title"),
        icon: <ListChecks size={16} />,
        onSelect: choice.onManageCommandAllowlist,
      } satisfies SidebarMenuItem] : []),
    ],
  };
}

function approvalItem(name: string, choice: ApprovalChoice): SidebarMenuItem {
  const { current, note, items } = approvalMenu(choice);
  const CurrentIcon = current.Icon;
  return {
    key: "approval",
    separatorBefore: true,
    label: t("botSettings.simple.beforeActs", { name }),
    subtitle: current.label,
    note,
    icon: <CurrentIcon size={16} />,
    onSelect: () => {},
    submenu: items,
  };
}

/** The thread's approval level as a small pill that opens its choices: in the Simple composer while it is not the
 * default, and on the bot panel's Details. */
export function ApprovalChip({ choice, quiet = false }: { choice: ApprovalChoice; quiet?: boolean }) {
  const { current, note, items } = approvalMenu(choice);
  const CurrentIcon = current.Icon;
  return (
    <SidebarPopoverMenu
      items={items}
      ariaLabel={t("approvalMode.triggerAria", { mode: current.label, provider: choice.providerName })}
      triggerClassName="flex shrink-0 rounded-full"
      triggerTitle={note ? `${current.label} · ${note}` : current.label}
      renderTrigger={({ open }) => (
        <span
          data-approval-chip={current.mode}
          className={cn(
            "flex h-7 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-[13px] transition-colors",
            open ? "bg-ink/[0.11] text-ink" : quiet ? "text-ink-secondary hover:bg-ink/[0.06] hover:text-ink" : "bg-ink/[0.06] text-ink-secondary hover:bg-ink/[0.11] hover:text-ink",
          )}
        >
          <CurrentIcon size={14} aria-hidden="true" />
          {current.chip}
        </span>
      )}
    />
  );
}

/**
 * The composer's round +: attach files, Work until done (Finish together in a group) and Teach a task. A phone's + also
 * holds what its narrow composer has no room for: the thread's approval level and the call mode. With attaching the
 * only choice, the + opens the file picker.
 */
/** Grok's Teach a task mark: a red record button, as teaching records what you do. */
function TeachMark() {
  return <span className="flex size-3.5 items-center justify-center rounded-full border-[1.5px] border-danger"><span className="size-1.5 rounded-full bg-danger" /></span>;
}

export function ComposerPlusMenu({ onAttach, attachChoices, goal, teach, approval, callBotId, circle = false }: {
  onAttach: () => void;
  /** A phone or touch screen: the photo library and the camera beside Files (ComposerFilePickers). */
  attachChoices?: AttachChoices;
  /** Starts a /learn draft in the field, where the composer offers /learn. */
  teach?: () => void;
  /** The phone dock: a round button of its own beside the field, not a small chip inside it. */
  circle?: boolean;
  goal?: { on: boolean; onToggle: () => void; solo?: boolean };
  approval?: { name: string; choice: ApprovalChoice };
  /** The bot whose call button the call mode starts, as that button's own mode menu did. */
  callBotId?: string;
}) {
  const { capabilities, ready } = useDesktopCapabilities();
  const { state } = useStore();
  const storedMode = useCallMode();
  const onCall = useOnCall();
  const media = useLiveMedia();
  const turnsHere = !ready || listensHere(capabilities, state.config);
  const callMode = effectiveCallMode(storedMode, { turnsHere, canLive: true });
  const turnsHelp = turnsHere ? null : callCapabilityHelp(capabilities, Boolean(speechBridge()?.speechStart), serverListeningReady(state.config));
  // As the call button, which hides while Live is the mode and its line is held on another device.
  const lineHeldElsewhere = callMode === "live" && liveLineHeldElsewhere(media, state.liveCall);
  const calling = callBotId !== undefined && (onCall === callBotId || isLiveCallRunning(media.phase) || lineHeldElsewhere);
  const items: SidebarMenuItem[] = [
    ...(attachChoices ? [
      { key: "attach:photos", label: t("composer.attach.photos"), icon: <Images size={16} />, onSelect: attachChoices.photos },
      { key: "attach:camera", label: t("composer.attach.camera"), icon: <Camera size={16} />, onSelect: attachChoices.camera },
    ] satisfies SidebarMenuItem[] : []),
    { key: "attach", label: t(attachChoices ? "composer.attach.files" : "composer.attachFiles"), icon: circle || attachChoices ? <Paperclip size={16} /> : <Icon name="paperclip" size={14} />, onSelect: onAttach },
    // grok's + holds Attach files and Teach a task alone: a bot's Work until done lives in its panel's Details
    ...(goal && (circle || !goal.solo) ? [{
      key: "goal",
      separatorBefore: circle,
      label: t(goal.solo ? "composer.goal.soloAria" : "composer.goal.aria"),
      icon: <Target size={16} />,
      active: goal.on,
      trailing: goal.on ? check : undefined,
      onSelect: goal.onToggle,
    } satisfies SidebarMenuItem] : []),
    ...(teach ? [{ key: "teach", separatorBefore: circle && !goal, label: t("composer.teachTask"), icon: circle ? <GraduationCap size={16} /> : <TeachMark />, onSelect: teach } satisfies SidebarMenuItem] : []),
    ...(approval ? [approvalItem(approval.name, approval.choice)] : []),
    // the phone's + lists only the call modes it can start, so the menu stays one short screen
    ...(callBotId === undefined ? [] : CALL_MODES.filter((entry) => !circle || entry.id !== "turns" || !turnsHelp).map((entry, index): SidebarMenuItem => {
      const unavailable = entry.id === "turns" ? turnsHelp : null;
      return {
        key: `call:${entry.id}`,
        heading: index === 0 ? t("call.mode.menu") : undefined,
        separatorBefore: index === 0,
        label: t(entry.label),
        // Only a reason it can't be used: the modes' long hints would make the + menu a page.
        note: unavailable ? `${unavailable.label}. ${unavailable.reason}` : undefined,
        icon: entry.id === "live" ? <Phone size={16} /> : <AudioLines size={16} />,
        trailing: callMode === entry.id ? check : undefined,
        disabled: calling || Boolean(unavailable),
        onSelect: () => requestCallStart(callBotId, entry.id),
      };
    })),
  ];
  const trigger = (open: boolean) => circle ? (
    <span
      data-composer-plus
      className={cn(
        // inside the message pill, at its left edge: a plain glyph, the pill's first 32 px control
        "flex size-8 items-center justify-center rounded-full text-ink-secondary transition-colors duration-[120ms]",
        open ? "text-ink" : "hover:text-ink",
      )}
    >
      <Plus size={22} aria-hidden="true" />
    </span>
  ) : (
    <Icon name="plus" variant="filled" size={16} />
  );
  // grok's + is the round control itself, not a button around one
  const plusClass = (open: boolean) => cn("flex shrink-0 items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus", SIMPLE_CONTROL, open && "bg-ink/10 text-ink");
  if (!circle && items.length === 1) {
    return (
      <button type="button" data-composer-plus onClick={onAttach} aria-label={t("composer.attachFiles")} className={plusClass(false)}>
        {trigger(false)}
      </button>
    );
  }
  if (!circle) return <ComposerMenu items={items} renderTrigger={trigger} triggerClass={plusClass} />;
  return (
    <SidebarPopoverMenu
      items={items}
      ariaLabel={t("composer.add")}
      triggerTitle={t("composer.add")}
      triggerClassName="flex shrink-0 rounded-full"
      renderTrigger={({ open }) => trigger(open)}
    />
  );
}

/** The composer's own + menu: a short list just above the +, in the app's large menu style. Escape or a click
 * elsewhere closes it and hands focus back to the +. */
function ComposerMenu({ items, renderTrigger, triggerClass }: { items: SidebarMenuItem[]; renderTrigger: (open: boolean) => ReactNode; triggerClass: (open: boolean) => string }) {
  const [open, setOpen] = useState(false);
  const motion = useMenuMotion(open);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  };
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  const rows = () => [...(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? [])];
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close(true);
      return;
    }
    const list = rows();
    const next = nextMenuIndex(event.key, list.indexOf(document.activeElement as HTMLButtonElement), list.length);
    if (next === null) return;
    event.preventDefault();
    list[next]?.focus();
  };
  return (
    <div ref={rootRef} className="relative flex shrink-0" onKeyDown={open ? onKeyDown : undefined}>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={t("composer.add")}
        title={open ? undefined : t("composer.add")}
        data-composer-plus
        onClick={(event) => {
          const opening = !open;
          setOpen(opening);
          // A keyboard press lands on the first row, as every menu here does.
          if (opening && event.detail === 0) requestAnimationFrame(() => rows()[0]?.focus());
        }}
        className={triggerClass(open)}
      >
        {renderTrigger(open)}
      </button>
      {motion.shown && (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={t("composer.add")}
          data-composer-menu
          {...motion.exitProps}
          className={cn(
            "popover-surface absolute bottom-full start-0 z-40 mb-1 flex w-max min-w-[200px] max-w-[280px] origin-bottom-left flex-col gap-0.5 rounded-[16px] bg-menu p-1.5",
            motion.className,
          )}
        >
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              role="menuitem"
              data-menu-key={item.key}
              disabled={item.disabled}
              onClick={() => {
                close(false);
                item.onSelect();
              }}
              className="flex h-8 w-full items-center gap-1.5 rounded-[10px] px-2 text-start text-[14px] leading-5 tracking-[0.01em] text-ink transition-colors hover:bg-menu-hover focus-visible:bg-menu-hover focus-visible:outline-none disabled:opacity-50"
            >
              <span className={cn("flex size-[18px] shrink-0 items-center justify-center [&_svg]:size-3.5 [&_svg]:stroke-[1.75]", item.active ? "text-accent" : "text-ink/[0.66]")} aria-hidden="true">{item.icon}</span>
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
              {item.trailing}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
