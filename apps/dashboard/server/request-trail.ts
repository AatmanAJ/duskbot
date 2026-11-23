/** the apps poll their session every few seconds: a quick successful poll is no step of an action anyone follows, and
 *  a line for each (about 500 a minute) would leave the service log, rotated at 2 MB, holding only minutes */
const POLLS = new Set(["/api/cloud/desktop/session"]);
export const SLOW_MS = 2_000;

export function traceWorthy(path: string | undefined, status: number, ms: number): boolean {
  return !(POLLS.has((path ?? "").split("?")[0]!) && status < 400 && ms < SLOW_MS);
}
