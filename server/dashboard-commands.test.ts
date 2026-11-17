import { describe, expect, it } from "vitest";
import { createDashboardCommands, plainError } from "./dashboard-commands.ts";
import { NO_APPS_SERVICE } from "./composio.ts";

const command = (kind: "app.connect" | "routine.pause", target: string) => ({ id: "cmd_1", kind, target, issuedAt: 0, expiresAt: Date.now() + 60_000 });
function commands(status: number, body: unknown) {
  const collect = { bots: () => [{ id: "b", name: "b", routines: [{ id: "r1", name: "daily" }] }] } as never;
  return createDashboardCommands({ port: 1, collect, fetch: (async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })) as typeof fetch });
}

describe("dashboard commands", () => {
  it("hands back the cloud's own reason an app could not connect", async () => {
    expect(await commands(409, { error: NO_APPS_SERVICE }).execute(command("app.connect", "gmail"))).toMatchObject({ ok: false, message: NO_APPS_SERVICE });
    expect(await commands(502, { error: "Composio authorization: HTTP 502" }).execute(command("app.connect", "gmail"))).toMatchObject({ ok: false, message: "Composio authorization: HTTP 502" });
  });

  it("keeps a server error with a link, a path or a stack in it to itself", async () => {
    for (const error of ["fetch failed https://backend.composio.dev/api/x", "ENOENT /data/.openmausbot/x.json", "boom\n    at run (index.js:1:1)"]) {
      expect((await commands(500, { error }).execute(command("app.connect", "gmail"))).message).toBe("The workspace could not complete this action.");
    }
    expect(plainError("")).toBe(false);
    expect(plainError("x".repeat(241))).toBe(false);
  });

  it("returns the sign-in page an app hands back", async () => {
    expect(await commands(200, { url: "https://connect.composio.dev/link/lk_abc" }).execute(command("app.connect", "gmail"))).toMatchObject({ ok: true, url: "https://connect.composio.dev/link/lk_abc" });
  });
});

describe("a phone signed in to the account asking to link", () => {
  const pair = { id: "cmd_2", kind: "phone.pair" as const, target: "Sid's iPhone", issuedAt: 0, expiresAt: Date.now() + 60_000 };
  it("mints the same grant the pairing qr carries, with the Mac companion's addresses when it already runs", async () => {
    const sent: Array<{ url: string; body: unknown }> = [];
    const link = "duskbot://pair?m=eyJ2IjoyfQ";
    const runner = createDashboardCommands({ port: 7, collect: {} as never, companion: async () => [{ url: "http://192.168.1.4:5331", kind: "lan", priority: 1 }],
      fetch: (async (url: string, init: RequestInit) => { sent.push({ url, body: JSON.parse(String(init.body)) }); return new Response(JSON.stringify({ link, code: null })); }) as typeof fetch });
    expect(await runner.execute(pair)).toMatchObject({ ok: true, link });
    expect(sent).toEqual([{ url: "http://127.0.0.1:7/api/mobile/pairing", body: { label: "Sid's iPhone", companion: [{ url: "http://192.168.1.4:5331", kind: "lan", priority: 1 }] } }]);
  });

  it("says unreachable when no route a phone can use exists, and refused otherwise", async () => {
    expect(await commands(409, { error: "x", code: "unreachable" }).execute(pair)).toMatchObject({ ok: false, reason: "unreachable" });
    expect(await commands(403, { error: "x", code: "sign_in_instead" }).execute(pair)).toMatchObject({ ok: false, reason: "refused" });
    expect(await commands(200, { link: "https://elsewhere.example" }).execute(pair)).toMatchObject({ ok: false, reason: "refused" });
  });
});

describe("connecting an app with no Composio set up", () => {
  it("is refused with what to do, as a 409 the dashboard shows", async () => {
    const { authorizeService, setManagedBrokerAccess } = await import("./composio.ts");
    setManagedBrokerAccess(null);
    await expect(authorizeService({} as never, "gmail")).rejects.toMatchObject({ status: 409, message: NO_APPS_SERVICE });
  });
});
