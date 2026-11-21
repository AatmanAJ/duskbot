export const CONFIRM_PHRASE: "start fresh";
export function confirmed(typed: unknown): boolean;
export const DESKTOP_MARKER: string;
export function keptInDataDir(name: string): boolean;

export type StartFreshStepKind = "signout" | "ai" | "local";
export type StartFreshStatus = "pending" | "running" | "done" | "failed";
export interface StartFreshStep {
  id: string;
  kind: StartFreshStepKind;
  label: string;
  status: StartFreshStatus;
  error?: string;
  code?: string;
}
export interface StartFreshView {
  phase: "idle" | "running" | "done" | "partial" | "restarting";
  steps: StartFreshStep[];
}
export interface StartFresh {
  view(): StartFreshView;
  preview(): StartFreshView;
  run(typed: string): Promise<StartFreshView>;
  retry(): Promise<StartFreshView>;
  finish(): Promise<StartFreshView>;
}
export function createStartFresh(deps: {
  account(): { email: string } | null;
  signOut(): Promise<void>;
  removeAiKeys(): Promise<void>;
  markLocal(): void;
  relaunch(): void;
  changed?(view: StartFreshView): void;
  log?(line: string): void;
}): StartFresh;
export function applyPendingDesktopStartFresh(input: { userData: string; dataDir: string; fs?: typeof import("node:fs"); log?: (line: string) => void }): boolean;
export function markDesktopStartFresh(userData: string, fs?: typeof import("node:fs")): void;
