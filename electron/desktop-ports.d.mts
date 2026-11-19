/** The desktop app serves its own page on the first of these that is free; each has its own page storage. */
export declare const DESKTOP_PORTS: readonly number[];
export declare function companionPorts(harnessPort: number): { companion: number; control: number };
export declare function companionFolder(options: { home: string; harnessPort: number; packaged: boolean }): string;
