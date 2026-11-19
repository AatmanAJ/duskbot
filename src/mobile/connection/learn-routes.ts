import { BACKGROUND_HEADERS } from "@/lib/cloud-power";
import { mobileTransports, type MobileConnectionRecord, type MobileRoutesResponse, type MobileTransport } from "../../../shared/mobile-link";
import type { PhoneTransport } from "../transport/transport";

/** The saved routes with the place's current ones in: its https addresses and (when the computer said) its Wi-Fi and
 * tailnet addresses replace the old, the relay entries stay, and the route this connect just worked over is never
 * dropped. Null when nothing changes. */
export function mergedRoutes(record: Pick<MobileConnectionRecord, "via" | "origin" | "transport">, now: MobileRoutesResponse, working: PhoneTransport): MobileTransport[] | null {
  const saved: MobileTransport[] = record.via ?? (record.origin ? [record.transport === "companion"
    ? { kind: "companion", url: record.origin, net: "lan", priority: 0 }
    : { kind: "https", url: record.origin }] : []);
  const companion = now.companion ?? saved.filter((route) => route.kind === "companion");
  const fresh = mobileTransports([...now.https, ...saved.filter((route) => route.kind === "relay"), ...companion]);
  const urlOf = (route: MobileTransport) => (route.kind === "relay" ? null : route.url);
  const kept = working.kind === "bearer" ? saved.find((route) => urlOf(route) === working.origin) : undefined;
  const merged = kept && !fresh.some((route) => urlOf(route) === urlOf(kept)) ? [kept, ...fresh] : fresh;
  return JSON.stringify(merged) === JSON.stringify(saved) ? null : merged;
}

/** Asks the place it just connected to for its routes now and saves them, so an address that changed since pairing is
 * learned instead of walked past forever. Quiet: an older place without the route, or no answer, keeps what is saved. */
export async function learnRoutes(record: MobileConnectionRecord, working: PhoneTransport & { asleep?: true },
  save: (id: string, via: MobileTransport[]) => Promise<void>, ask: typeof fetch = fetch): Promise<void> {
  if (working.asleep || working.kind === "same-origin") return;
  try {
    const response = await ask("/api/mobile/routes", { headers: BACKGROUND_HEADERS, signal: AbortSignal.timeout(15_000) });
    if (!response.ok) { await response.body?.cancel().catch(() => {}); return; }
    const answer = await response.json() as Partial<MobileRoutesResponse>;
    if (!Array.isArray(answer.https) || !(answer.companion === null || Array.isArray(answer.companion))) return;
    const via = mergedRoutes(record, { https: answer.https, companion: answer.companion }, working);
    if (via) await save(record.id, via);
  } catch { /* the saved routes stay */ }
}
