// What a browser tells a bot's call it does not run, by design: the bot reads these as the call's result.

export const BROWSER_RESTART_TOOL = "restart_browser";
export const BROWSER_CONTROL_REFUSAL = "Browser tools are paused while a person controls this browser. Wait for them to hand control back; do not try another browser or execution tool.";
export const BROWSER_INTERRUPTED = `The browser engine is stuck. Press Restart in the Browser panel, or call ${BROWSER_RESTART_TOOL}, before using browser tools again.`;
export const BROWSER_CLOSING = "The browser is closing. Try again shortly.";
export const RESTART_BUSY = "The browser is busy. Wait for current work to finish before restarting.";
export const LAUNCH_CHANGED = "Browser launch settings changed. Close the browser before reconnecting.";
export const AGENT_CLOSE_FAILED = "The browser could not be closed. Ask the person to press Restart in the Browser panel of dusk bot on their computer, or to restart dusk bot.";
export const LANE_BUSY = "Your previous browser call is still running; wait for it to finish, then call again.";
export const PERSON_RESTART_STOPPED = "The person restarted your browser from the Browser panel while this call ran, so it stopped. Pages you had open are gone: open the page you need again, and check whether this action already happened before repeating it.";

const KNOWN = new Set([BROWSER_CONTROL_REFUSAL, BROWSER_INTERRUPTED, BROWSER_CLOSING, RESTART_BUSY, LAUNCH_CHANGED, AGENT_CLOSE_FAILED, LANE_BUSY]);

/** The words of a refusal by design, or null for a fault, which stays an error (a 500 with its reason in the trail). */
export function browserRefusal(error: unknown): string | null {
  if (!(error instanceof Error) || typeof (error as { status?: unknown }).status === "number") return null;
  return KNOWN.has(error.message) || error.message.startsWith("This browser cannot ") ? error.message : null;
}
