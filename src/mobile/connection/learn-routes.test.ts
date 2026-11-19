import { describe, expect, it, vi } from "vitest";
import type { MobileConnectionRecord, MobileTransport } from "../../../shared/mobile-link";
import type { RelayChannel } from "../transport/relay";
import { learnRoutes, mergedRoutes } from "./learn-routes";

const relayRoute: MobileTransport = { kind: "relay", base: "https://link.dusk.bot", channel: "abcdefghij", token: "t".repeat(43), key: "k".repeat(43) };
const oldWifi: MobileTransport = { kind: "companion", url: "http://192.168.1.4:8810", net: "lan", priority: 200 };
const record = (via: MobileTransport[]): MobileConnectionRecord => ({
  id: "mac", environmentId: "env", label: "Mac", transport: "relay", via, sessionRef: "token.mac",
  capabilities: {} as MobileConnectionRecord["capabilities"], addedAt: 1, lastUsedAt: 1,
});
const onRelay = { kind: "relay" as const, channel: {} as RelayChannel, token: "s" };

describe("a phone learning where its place is now", () => {
  it("takes the computer's new Wi-Fi address and a new https address, keeping its relay", () => {
    const via = mergedRoutes(record([relayRoute, oldWifi]), {
      https: [{ kind: "https", url: "https://box.example.com" }],
      companion: [{ kind: "companion", url: "http://192.168.1.9:8810", net: "lan", priority: 200 }],
    }, onRelay);
    expect(via).toEqual([{ kind: "https", url: "https://box.example.com" }, relayRoute, { kind: "companion", url: "http://192.168.1.9:8810", net: "lan", priority: 200 }]);
  });

  it("keeps its Wi-Fi addresses when the computer did not say, and changes nothing when nothing moved", () => {
    expect(mergedRoutes(record([relayRoute, oldWifi]), { https: [], companion: null }, onRelay)).toBeNull();
  });

  it("never drops the route it just connected over", () => {
    const via = mergedRoutes(record([oldWifi]), { https: [], companion: [] }, { kind: "bearer", origin: oldWifi.url, token: "s" });
    expect(via).toBeNull();
    const cloud = { ...record([]), via: undefined, transport: "https" as const, origin: "https://d1.dusk.bot" };
    expect(mergedRoutes(cloud, { https: [], companion: null }, { kind: "bearer", origin: "https://d1.dusk.bot", token: "s" })).toBeNull();
  });

  it("saves what the place says, and an older place without the route keeps what is saved", async () => {
    const save = vi.fn(async () => {});
    const answer = { https: [{ kind: "https", url: "https://box.example.com" }], companion: null };
    await learnRoutes(record([relayRoute]), onRelay, save, (async () => new Response(JSON.stringify(answer))) as typeof fetch);
    expect(save).toHaveBeenCalledWith("mac", [answer.https[0], relayRoute]);
    save.mockClear();
    await learnRoutes(record([relayRoute]), onRelay, save, (async () => new Response("{}", { status: 404 })) as typeof fetch);
    await learnRoutes(record([relayRoute]), onRelay, save, (async () => { throw new TypeError("offline"); }) as typeof fetch);
    await learnRoutes(record([relayRoute]), { ...onRelay, asleep: true }, save, (async () => new Response(JSON.stringify(answer))) as typeof fetch);
    expect(save).not.toHaveBeenCalled();
  });
});
