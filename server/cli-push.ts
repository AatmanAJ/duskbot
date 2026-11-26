// `duskbot push`: which phones can get notifications from this server, and `duskbot push test` sends each one a test
// notification and says what the push service answered, so a phone that never gets pushes is never a silent mystery.
import type { MobileDevice, PushTestResponse } from "../shared/mobile-link.ts";

type Loopback = (path: string, init?: { method?: string; body?: string; timeoutMs?: number }) => Promise<{ status: number; body: any }>;
type Io = { log(line: string): void; error(line: string): void };

const OUTCOME: Record<PushTestResponse["results"][number]["outcome"], string> = {
  sent: "sent: it should show on the phone in a few seconds",
  unregistered: "not registered: open the dusk bot app on this phone and allow notifications (Settings, Notifications)",
  gone: "the phone's push token is no longer valid: open the dusk bot app on it once to register again",
  skipped: "not sent: nothing can deliver to this phone yet (no push keys here and the push relay has none for it)",
  failed: "failed: the push service did not take it; check this server can reach the push relay, then try again",
};

export async function runPush(action: "status" | "test", call: Loopback, io: Io): Promise<number> {
  const devices = await call("/api/mobile/devices").catch(() => null);
  if (!devices) { io.error("No dusk bot server answered on this computer: start one with duskbot serve, or pass its --port."); return 1; }
  if (devices.status === 403) { io.error("This server did not let this computer list its phones. Run duskbot push on the server itself."); return 1; }
  if (devices.status !== 200) { io.error(`The server did not list its phones (${devices.status}).`); return 1; }
  const phones = (devices.body?.devices ?? []) as MobileDevice[];
  if (!phones.length) {
    io.log("No paired phones. A phone signed in with a code from a browser is not a paired phone and gets no notifications.");
    io.log("Pair one with: duskbot pair --phone ios (or android)");
    return action === "test" ? 1 : 0;
  }
  if (action === "status") {
    const where = await call("/api/mobile/push", { timeoutMs: 8_000 }).catch(() => null);
    for (const phone of phones) io.log(`${phone.name} (${phone.platform}): ${phone.push ? `registered for ${phone.push === "apns" ? "APNs" : "FCM"}` : "not registered for notifications"}`);
    if (where?.status === 200) {
      const { own, relay, relayServices } = where.body as { own: string[]; relay: string | null; relayServices: string[] | null };
      io.log(own.length ? `push keys on this server: ${own.join(", ")}` : relay ? `push relay: ${relay}${relayServices ? ` (delivers ${relayServices.join(", ") || "nothing"})` : " (did not answer just now)"}` : "push: off (DUSK_PUSH_RELAY=off and no keys on this server)");
    }
    io.log("Send each phone a test notification with: duskbot push test");
    return 0;
  }
  const answer = await call("/api/mobile/push/test", { method: "POST", body: "{}", timeoutMs: 30_000 }).catch(() => null);
  if (!answer || answer.status === 404) { io.error("This server is too old to send a test notification. Update it, then try again."); return 1; }
  if (answer.status !== 200) { io.error(`The server did not send the test (${typeof answer.body?.error === "string" ? answer.body.error : answer.status}).`); return 1; }
  const result = answer.body as PushTestResponse;
  for (const one of result.results) io.log(`${one.name} (${one.platform}): ${OUTCOME[one.outcome]}`);
  if (result.relay) io.log(`(pushes go through ${result.relay})`);
  return result.results.every((one) => one.outcome === "sent") ? 0 : 1;
}
