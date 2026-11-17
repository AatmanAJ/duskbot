/** the person came from the desktop app's account step (the account context redirect): after paying, the page sends
 *  them back to the app. Kept for the browser tab's session. */
export const FROM_APP_KEY = "dusk.fromApp";
/** the app's link after a purchase: dusk bot opens its cloud sheet, which picks the new cloud up */
export const APP_CLOUD_LINK = "duskbot://cloud";
const appQuery = (query: URLSearchParams) => query.get("from") === "app" || (query.get("src") ?? "").startsWith("app_");
export function markFromApp(query: URLSearchParams) {
  if (appQuery(query)) { try { sessionStorage.setItem(FROM_APP_KEY, "1"); } catch {} }
}
export function fromApp(): boolean { try { return sessionStorage.getItem(FROM_APP_KEY) === "1"; } catch { return false; } }
/** this visit is the app's (its link, its plans or checkout): the app runs the first steps, so the website never starts
 *  its own setup on top */
export const cameFromApp = (query: URLSearchParams): boolean => fromApp() || appQuery(query);
