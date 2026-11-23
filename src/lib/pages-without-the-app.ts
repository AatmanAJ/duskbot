/** The paths whose page never runs the app: the desktop's own windows and a phone's sign-in. */
export const PAGES_WITHOUT_THE_APP: ReadonlySet<string> = new Set(["/home", "/reconnect", "/pair", "/desktop-viewer"]);
