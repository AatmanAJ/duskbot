import { readUsageSignals, saveUsageSignals } from "@/lib/help-improve";

let shown = false;

export function notesAskShown(): boolean {
  return shown;
}

/** For tests: a new app session. */
export function resetNotesAsk(): void {
  shown = false;
}

/** The server decides who is asked (`askNotes`); a failed read never asks. */
export async function notesAskDue(): Promise<boolean> {
  if (shown) return false;
  try {
    return (await readUsageSignals()).askNotes === true;
  } catch {
    return false;
  }
}

/** Asked once ever: the moment the card shows, the answer is recorded as no, so no device asks again. */
export function markNotesAskShown(): void {
  if (shown) return;
  shown = true;
  void saveUsageSignals({ notes: false }, "first_run", null).catch(() => {});
}

export async function shareSessionNotes(): Promise<void> {
  await saveUsageSignals({ notes: true }, "first_run", null);
}
