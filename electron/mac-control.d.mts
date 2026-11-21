export interface MacControlHost {
  follow(origin: string | null): void;
  serving(): string | null;
  close(): void;
}
export declare function createMacControlHost(deps: {
  fetch(input: string, init?: RequestInit): Promise<Response>;
  name(): string;
  execute(job: unknown, io: { download(path: string): Promise<Response> }): Promise<unknown>;
  log?(line: string): void;
  wait?(ms: number, signal: AbortSignal): Promise<void>;
  query?(): Array<[string, string]>;
  ready?(): boolean;
  reauth?(): Promise<boolean>;
  open?(body: unknown): { job: unknown; wrap(outcome: unknown): unknown } | null;
  state?(state: "connected" | "refused" | "connecting", why?: string | null): void;
}): MacControlHost;
