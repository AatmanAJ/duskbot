export type TrailFields = Record<string, unknown>;
export interface TrailEvent { ts: string; ev: string; src?: string; [field: string]: unknown }
export interface TrailWriter {
  write(event: TrailEvent): void;
  flush(): Promise<void>;
  flushSync(): void;
  close(): void;
  prune?(): Promise<void>;
  file?: string;
}

export const TRAIL_DAYS: number;
export const TRAIL_CAP_BYTES: { packaged: number; dev: number };
export const TRAIL_HEADER: string;
export const TRAIL_EXPORT_PREVIEW: string;
export const RUN_ID: string;
export function isVerboseEvent(ev: unknown): boolean;
export function secretKey(key: string): boolean;
export function contentKey(key: string): boolean;
export function urlHostPath(raw: string): string;
export function scrubString(value: unknown): string;
export function redactFields(fields: unknown, depth?: number): TrailFields;
export function toolName(value: unknown): string | undefined;
export function redactEvent(event: unknown): TrailEvent | null;
export function hashName(value: string, salt?: string): string;
export function scrubForExport(event: unknown, options?: { home?: string; salt?: string }): TrailEvent | null;
export function newTrailId(bytes?: number): string;
export function validTrailId(value: unknown): value is string;
export function shortHash(value: string): string;
export function createTrailWriter(options: { dir: string; prefix?: string; capBytes?: number; days?: number; now?: () => number; flushMs?: number }): TrailWriter & { prune(): Promise<void>; file: string };
export function createStdoutWriter(out?: { write(text: string): unknown }): TrailWriter;
export function configureTrail(options: { src: string; writer: TrailWriter; context?: () => TrailFields | null }): TrailWriter;
export function trailSink(): TrailWriter | null;
export function trail(ev: string, fields?: TrailFields): void;
export function trailError(code: string, error: unknown, fields?: TrailFields): void;
export function trailFrom(src: string, events: unknown, extra?: (ev: string, fields: TrailFields) => TrailFields): number;
export function trailFiles(dir: string): Promise<Array<{ name: string; file: string; at: number }>>;
export function readTrail(dir: string, options?: { sinceMs?: number; untilMs?: number }): Promise<TrailEvent[]>;
