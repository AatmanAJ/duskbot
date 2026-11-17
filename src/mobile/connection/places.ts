import { useCallback, useEffect, useRef, useState } from "react";
import type { MobileConnectionRecord } from "../../../shared/mobile-link";
import { useMobileAccount } from "../account/AccountGate";
import { usePlatform } from "../platform";
import type { AccountPlaces, CloudPairGrant, CloudPairResult, ComputerPairResult, MobileCloud, MobileComputer, MobileTeamCloud } from "../account/account-client";
import { cloudPairing } from "../account/cloud-pair";
import { useConnections } from "./connections";

export type PlaceStatus = "online" | "asleep" | "offline";
export type PlaceTarget = { kind: "linked"; id: string } | { kind: "cloud"; cloud: MobileCloud } | { kind: "team"; cloud: MobileTeamCloud } | { kind: "computer"; computer: MobileComputer };
export type PlaceOutcome = CloudPairResult["outcome"] | ComputerPairResult["outcome"] | "switched";
export type Place = { key: string; name: string; status: PlaceStatus; active: boolean; target: PlaceTarget };

const GONE = new Set(["ended", "checkout", "destroyed"]);

function cloudStatus(cloud: { status: string; asleep: boolean }): PlaceStatus {
  if (cloud.status === "ready") return cloud.asleep ? "asleep" : "online";
  return cloud.status === "stopped" ? "asleep" : "offline";
}

function recordOrigins(record: Pick<MobileConnectionRecord, "origin" | "via">): string[] {
  const origins = [record.origin, ...(record.via ?? []).map((route) => (route.kind === "https" ? route.url : undefined))];
  return origins.filter((origin): origin is string => Boolean(origin));
}

/** Everything the person can open from this phone: the places it already links to, then the account's own clouds, its
 * teams' clouds and its computers it does not link to yet. A linked place the account also lists shows once, with the
 * account's status. */
export function mergePlaces({ records, activeId, connected, account }: {
  records: readonly MobileConnectionRecord[];
  activeId: string | null;
  connected: boolean;
  account: AccountPlaces | null;
}): Place[] {
  const clouds = (account?.clouds ?? []).filter((cloud) => !GONE.has(cloud.status));
  const teams = account?.teams ?? [];
  const computers = account?.computers ?? [];
  const claimed = new Set<string>();
  const linked = records.map((record): Place => {
    const origins = recordOrigins(record);
    const match = [...clouds, ...teams].find((cloud) => cloud.origin && origins.includes(cloud.origin));
    const computer = match ? undefined : computers.find((one) => one.environmentId !== null && one.environmentId === record.environmentId);
    if (match) claimed.add(match.id);
    if (computer) claimed.add(computer.id);
    const active = record.id === activeId;
    const status: PlaceStatus = active && connected ? "online" : match ? cloudStatus(match) : computer ? computer.presence : "offline";
    return { key: `linked:${record.id}`, name: record.label.trim() || match?.name || computer?.name || record.label, status, active, target: { kind: "linked", id: record.id } };
  });
  const own = clouds.filter((cloud) => !claimed.has(cloud.id)).map((cloud): Place => ({ key: `cloud:${cloud.id}`, name: cloud.name, status: cloudStatus(cloud), active: false, target: { kind: "cloud", cloud } }));
  const team = teams.filter((cloud) => !claimed.has(cloud.id)).map((cloud): Place => ({ key: `team:${cloud.id}`, name: cloud.name, status: cloudStatus(cloud), active: false, target: { kind: "team", cloud } }));
  const machines = computers.filter((one) => !claimed.has(one.id)).map((computer): Place => ({ key: `computer:${computer.id}`, name: computer.name, status: computer.presence, active: false, target: { kind: "computer", computer } }));
  return [...linked, ...own, ...team, ...machines];
}

/** what the pairing step reads as a typed link: the cloud's address and its one-time code */
export const pairingText = (grant: CloudPairGrant) => `${grant.origin} ${grant.code.replace(/-/g, "")}`;

const seen = new Map<string, AccountPlaces>();
const COUNT_KEY = "dusk.mobile.places.count";

/** The places list for Settings: null until both the saved links and the account's answer are in, so the rows draw once
 * at their final size. The last answer per account is kept for the session, so reopening Settings draws at once, and the
 * last row count is kept on the phone, so the skeleton holds the same height. */
export function usePlaces(connected: boolean): { places: Place[] | null; expected: number; open(place: Place): Promise<PlaceOutcome> } {
  const { connections, activeId, loaded, switchTo } = useConnections();
  const platform = usePlatform();
  const [remembered, setRemembered] = useState(0);
  useEffect(() => { void platform.prefs.get(COUNT_KEY).then((value) => setRemembered(Number(value) || 0)).catch(() => {}); }, [platform]);
  const account = useMobileAccount();
  const accountRef = useRef(account);
  accountRef.current = account;
  const accountId = account?.account?.id ?? null;
  const [remote, setRemote] = useState<AccountPlaces | null | undefined>(() => (accountId ? seen.get(accountId) : null));
  useEffect(() => {
    const client = accountRef.current;
    if (!accountId || !client) { setRemote(null); return; }
    let live = true;
    setRemote(seen.get(accountId));
    void client.places().then((answer) => {
      if (!live) return;
      if (answer) seen.set(accountId, answer);
      setRemote(answer ?? seen.get(accountId) ?? null);
    });
    return () => { live = false; };
  }, [accountId]);
  const places = loaded && remote !== undefined ? mergePlaces({ records: connections, activeId, connected, account: remote }) : null;
  const count = places?.length;
  useEffect(() => { if (count !== undefined) void platform.prefs.set(COUNT_KEY, String(count)).catch(() => {}); }, [platform, count]);
  const open = useCallback(async (place: Place): Promise<PlaceOutcome> => {
    const { target } = place;
    if (target.kind === "linked") { await switchTo(target.id); return "switched"; }
    const client = accountRef.current;
    if (!client) return "signed-out";
    if (target.kind === "computer") {
      const result = await client.pairComputer(target.computer);
      if (result.outcome === "paired") window.dispatchEvent(new CustomEvent("dusk:pair-link", { detail: result.link }));
      return result.outcome;
    }
    const result = target.kind === "cloud" ? await cloudPairing(client, target.cloud) : await client.pairTeamCloud(target.cloud);
    if (result.outcome === "paired") window.dispatchEvent(new CustomEvent("dusk:pair-link", { detail: pairingText(result.grant) }));
    return result.outcome;
  }, [switchTo]);
  return { places, expected: remembered || connections.length, open };
}
