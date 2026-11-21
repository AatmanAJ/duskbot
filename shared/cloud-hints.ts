/** The onboarding hint a Cloud's welcome records when it is done: the app opens on the Chief's chat from then on. */
export const CLOUD_WELCOME_DONE = "cloud-welcome-done";
/** Recorded by the desktop app when it opens a new cloud it set up: the cloud runs the app's first run, with what that
 * computer already knows (cloud-welcome-carry.mjs), instead of its own welcome. */
export const CLOUD_FROM_COMPUTER = "cloud-from-computer";
/** That first run ended on the cloud. */
export const CLOUD_FIRST_RUN_DONE = "cloud-first-run-done";
/** One per AI signed in on that computer (its instance id after the prefix), so the cloud can offer the same ones. */
export const COMPUTER_AI_HINT = "computer-ai:";
