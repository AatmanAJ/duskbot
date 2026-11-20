export type CloudMacMode = "auto" | "ask" | "never";
export declare const CLOUD_MAC_MODES: readonly CloudMacMode[];
export declare function isCloudMacMode(value: unknown): value is CloudMacMode;
export declare function commandRisk(command: unknown): string | null;
export declare function macActionRisk(tool: string, args: Record<string, unknown> | null | undefined, home: string): string | null;
export declare function macApprovalReason(mode: CloudMacMode, tool: string, args: Record<string, unknown> | null | undefined, home: string): string | null;
export declare const EVERY_ACTION: string;
export declare const SCREEN_READS: readonly string[];
