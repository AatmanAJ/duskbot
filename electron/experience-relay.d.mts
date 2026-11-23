export type CrashProps = { kind: "page" | "gpu" | "utility" | "server" | "other"; reason: string; service?: string; exit?: string };
export function crashProps(type: string | undefined, reason: string | undefined, options?: { name?: string; ending?: boolean; exitCode?: number }): CrashProps | null;
export function exitWord(code: unknown): string | null;
export function updateFailStage(message: unknown): "install" | "download" | "manifest" | "checksum" | "other";
export function createExperienceRelay(deps: {
  localRequest(route: string): Promise<Response>;
  events: { install(): string | null; action(name: string, props: Record<string, unknown>, at?: number): boolean };
  setTimer?: typeof setTimeout;
  clearTimer?: typeof clearTimeout;
}): { start(): void; run(): Promise<number>; close(): void };
