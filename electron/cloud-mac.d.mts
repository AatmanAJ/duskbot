// loose types for the tests that import the mac app's cloud core
export declare const CLOUD_MAC_TOOLS: readonly string[];
export declare const DEFAULT_CWD: string;
export declare const DEFAULT_FOLDERS: readonly string[];
export declare const CLOUD_MAC_SEAL_INFO: string;
export declare function cloudMacSignedBytes(envelope: any): string;
export declare function cloudMacJobAad(mac: string, eph: string): string;
export declare function cloudMacOutcomeAad(jobId: string): string;
export declare function isLinkKey(value: unknown): boolean;
export declare function createCloudMacSeal(opts?: { now?: () => number }): any;
export declare function tildePath(value: string, home?: string): string;
export declare function insideFolders(value: string, folders: readonly string[], home?: string): Promise<any>;
export declare function defaultCwd(folders: readonly string[] | null | undefined): string;
export declare function cloudJobRefusal(job: any, opts: { folders?: readonly string[] | null; mode?: string; home?: string }): Promise<any>;
export declare function createCloudMac(deps: any): any;
