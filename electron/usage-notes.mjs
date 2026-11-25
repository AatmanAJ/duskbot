export const FIRST_MS = 60_000;
export const EVERY_MS = 10 * 60_000;
const REQUEST_MS = 20_000;
const ID = /^[A-Za-z0-9_-]{16,40}$/;

/** Sends this computer's waiting usage notes, and the note deletes it owes, to the account service when no account dashboard hears from its workspace
 * (signed out, or never linked). `install` is the page's analytics install id, so notes leave only while usage analytics
 * is on; the local server keeps a note until the account service took it. */
export function createUsageNotes({ origin, install, token = () => null, localRequest, platform, version, fetch: fetcher = globalThis.fetch,
  setTimer = setTimeout, clearTimer = clearTimeout }) {
  const endpoint = `${new URL(origin).origin}/v1/app/notes`;
  let timer = null, closed = false, running = null;

  async function tick() {
    const id = install();
    if (closed || typeof id !== "string" || !ID.test(id)) return false;
    const waiting = await localRequest("/api/dashboard/usage-notes");
    if (!waiting.ok) return false;
    const { notes, forget } = await waiting.json();
    const ids = notes ? [...(notes.frustrations ?? []), ...(notes.sessions ?? []), ...(notes.digests ?? [])].map(note => note.id).filter(Boolean) : [];
    const gone = Array.isArray(forget) ? forget.filter(id => typeof id === "string") : [];
    if (!ids.length && !gone.length) return false;
    const bearer = token();
    const response = await fetcher(endpoint, {
      method: "POST", redirect: "error", credentials: "omit", cache: "no-store",
      headers: { "content-type": "application/json", ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) },
      body: JSON.stringify({ install: id, platform: String(platform), version: String(version), ...(ids.length ? notes : {}), ...(gone.length ? { forget: gone } : {}) }),
      signal: AbortSignal.timeout(REQUEST_MS),
    });
    await response.body?.cancel().catch(() => {});
    if (response.status >= 300) return false;
    await localRequest("/api/dashboard/usage-notes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sent: ids, forgotten: gone }) });
    return true;
  }
  function schedule(delay) {
    if (closed || timer !== null) return;
    timer = setTimer(() => { timer = null; void run(); }, delay);
    timer?.unref?.();
  }
  async function run() {
    if (running) return running;
    running = tick().catch(() => false);
    try { return await running; } finally { running = null; schedule(EVERY_MS); }
  }
  return {
    start() { if (!closed && timer === null) schedule(FIRST_MS); },
    run,
    close() { closed = true; if (timer !== null) clearTimer(timer); timer = null; },
  };
}
