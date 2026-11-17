import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { appleNonce, createMobileAccount, isAccountAuthUrl, mobileFace } from "./account-client";
import { webPlatform, type MobilePlatform } from "../platform";

const origin = "https://accounts.example";
const token = `omc_${"t".repeat(43)}`;
const grant = () => ({ cloudContractVersion: 1, accessToken: token, expiresAt: Date.now() + 60_000, device: { id: "phone" }, account: { id: "person", email: "person@example.com" } });
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
let secrets: Map<string, string>, platform: MobilePlatform;
let fetcher: ReturnType<typeof vi.fn<typeof fetch>>;
let client: ReturnType<typeof createMobileAccount>;
const stored = (extra = {}) => ({ origin, token, expiresAt: Date.now() + 60_000, deviceId: "phone", account: grant().account, ...extra });
const started = () => ({ cloudContractVersion: 1, attempt: "a".repeat(43), expiresIn: 600, resendAfter: 30, signupOpen: true });
const start = async () => { fetcher.mockResolvedValueOnce(response(started())); return client.emailStart(" Person@Example.com "); };
beforeEach(() => {
  secrets = new Map();
  platform = { ...webPlatform(), kind: "ios", native: true, deviceName: () => `  ${"p".repeat(120)}  `, appVersion: "bad version", secrets: {
    get: async key => secrets.get(key) ?? null, set: async (key, value) => { secrets.set(key, value); }, remove: async key => { secrets.delete(key); },
  }, openExternal: vi.fn(async () => {}) };
  fetcher = vi.fn<typeof fetch>();
  client = createMobileAccount({ platform, origin, fetch: fetcher });
});

describe("restore", () => {
  it("validates a saved session with an isolated bearer request", async () => {
    secrets.set("dusk.account", JSON.stringify(stored())); fetcher.mockResolvedValue(response({}));
    expect(await client.restore()).toEqual(grant().account);
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe(`${origin}/api/cloud/desktop/session`);
    expect(init).toMatchObject({ credentials: "omit", headers: { authorization: `Bearer ${token}`, accept: "application/json", "content-type": "application/json" } });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });
  it("removes invalid tokens", async () => {
    secrets.set("dusk.account", JSON.stringify(stored())); fetcher.mockResolvedValue(response({ error: "invalid_token" }, 401));
    expect(await client.restore()).toBeNull(); expect(secrets.has("dusk.account")).toBe(false);
  });
  it("ignores a grant for another origin", async () => {
    secrets.set("dusk.account", JSON.stringify(stored({ origin: "https://other.example" })));
    expect(await client.restore()).toBeNull(); expect(fetcher).not.toHaveBeenCalled(); expect(secrets.has("dusk.account")).toBe(true);
  });
  it.each([true, false])("offline grace requires a future expiry: %s", async future => {
    secrets.set("dusk.account", JSON.stringify(stored({ expiresAt: Date.now() + (future ? 60_000 : -60_000) })));
    fetcher.mockRejectedValue(new TypeError("offline"));
    expect(await client.restore()).toEqual(future ? grant().account : null);
  });
  it.each([[503, { error: "failed" }], [429, { error: "rate_limited" }], [502, "<html>bad gateway</html>"]])("keeps a session that has not run out through a %s from the service", async (status, body) => {
    secrets.set("dusk.account", JSON.stringify(stored()));
    fetcher.mockResolvedValue(typeof body === "string" ? new Response(body, { status }) : response(body, status));
    expect(await client.restore()).toEqual(grant().account); expect(secrets.has("dusk.account")).toBe(true);
  });
  it("keeps a session through a captive portal's page that answers 200 with html", async () => {
    secrets.set("dusk.account", JSON.stringify(stored())); fetcher.mockResolvedValue(new Response("<html>sign in to wifi</html>", { status: 200 }));
    expect(await client.restore()).toEqual(grant().account);
  });
  it("saves the end the service slid the session to, so it stays signed in past the first sign-in's end", async () => {
    secrets.set("dusk.account", JSON.stringify(stored()));
    const later = Date.now() + 90 * 86_400_000;
    fetcher.mockResolvedValue(response({ ...grant(), expiresAt: later }));
    await client.restore();
    expect(JSON.parse(secrets.get("dusk.account")!).expiresAt).toBe(later);
  });
  it("reads the saved sign-in at once without the network", async () => {
    secrets.set("dusk.account", JSON.stringify(stored()));
    expect(await client.cached()).toEqual(grant().account); expect(client.account()).toEqual(grant().account); expect(fetcher).not.toHaveBeenCalled();
    secrets.set("dusk.account", JSON.stringify(stored({ origin: "https://other.example" })));
    expect(await createMobileAccount({ platform, origin, fetch: fetcher }).cached()).toBeNull();
  });
  it("rejects malformed stored tokens", async () => {
    secrets.set("dusk.account", JSON.stringify(stored({ token: "bad" })));
    expect(await client.restore()).toBeNull(); expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("Email sign-in", () => {
  it("normalizes email, bounds device data and stores a verified grant", async () => {
    expect(await start()).toMatchObject({ outcome: "sent", email: "person@example.com", signupOpen: true });
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual({ email: "person@example.com", deviceName: "p".repeat(100), platform: "ios", appVersion: "0.0.0" });
    fetcher.mockResolvedValueOnce(response(grant()));
    expect(await client.emailVerify("1234 5678")).toEqual({ outcome: "signed-in" });
    expect(JSON.parse(String(fetcher.mock.calls[1][1]?.body))).toEqual({ attempt: "a".repeat(43), code: "12345678" });
    expect(JSON.parse(secrets.get("dusk.account")!)).toMatchObject({ origin, token, deviceId: "phone", account: grant().account });
  });
  it("uses linux for a browser and preserves a valid app version", async () => {
    platform.kind = "web"; platform.appVersion = "1.2.3-beta+1"; await start();
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toMatchObject({ platform: "linux", appVersion: "1.2.3-beta+1" });
  });
  it("refuses invalid email and codes without a request", async () => {
    expect(await client.emailStart("nope")).toEqual({ outcome: "invalid-email" });
    expect(fetcher).not.toHaveBeenCalled(); await start();
    expect(await client.emailVerify("123")).toEqual({ outcome: "wrong-code", triesLeft: 5 }); expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each([[400, "invalid_request", "invalid-email"], [403, "sso", "sso"], [429, "anything", "rate-limited"], [404, "not_found", "browser"], [405, "unsupported", "browser"], [501, "not_found", "browser"], [500, "invalid_request", "failed"]])("maps start %s %s", async (status, error, outcome) => {
    fetcher.mockResolvedValueOnce(response({ error }, Number(status)));
    expect(await client.emailStart("p@example.com")).toEqual({ outcome });
  });
  it.each([[400, "invalid_code", "wrong-code"], [410, "anything", "expired"], [403, "sso", "sso"], [403, "two_factor", "two-factor"], [403, "signup_closed", "signup-closed"], [403, "device_limit", "device-limit"], [429, "anything", "rate-limited"], [404, "not_found", "browser"], [500, "invalid_code", "failed"]])("maps verify %s %s", async (status, error, outcome) => {
    await start(); fetcher.mockResolvedValueOnce(response({ error }, Number(status)));
    expect(await client.emailVerify("12345678")).toMatchObject({ outcome });
  });
  it("expires after five wrong codes", async () => {
    await start(); fetcher.mockImplementation(async () => response({ error: "invalid_code" }, 400));
    for (let triesLeft = 4; triesLeft > 0; triesLeft--) expect(await client.emailVerify("12345678")).toEqual({ outcome: "wrong-code", triesLeft });
    expect(await client.emailVerify("12345678")).toEqual({ outcome: "expired" });
  });
  it.each([{ cloudContractVersion: 2 }, { accessToken: "bad" }, { expiresAt: 1 }, { device: {} }, { account: { id: "", email: "bad" } }])("refuses malformed grants %j", async extra => {
    await start(); fetcher.mockResolvedValueOnce(response({ ...grant(), ...extra }));
    expect(await client.emailVerify("12345678")).toEqual({ outcome: "failed" }); expect(secrets.has("dusk.account")).toBe(false);
  });
  it("caps streamed and declared responses at 64 KB", async () => {
    fetcher.mockResolvedValueOnce(new Response(" ".repeat(65_537)));
    expect(await client.emailStart("p@example.com")).toEqual({ outcome: "failed" });
    fetcher.mockResolvedValueOnce(new Response("{}", { headers: { "content-length": "65537" } }));
    expect(await client.emailStart("p@example.com")).toEqual({ outcome: "failed" });
  });
  it("treats an HTML missing route as browser sign-in", async () => {
    fetcher.mockResolvedValueOnce(new Response("<html>not found</html>", { status: 404 }));
    expect(await client.emailStart("p@example.com")).toEqual({ outcome: "browser" });
  });
});

describe("browser sign-in", () => {
  it("opens a PKCE S256 URL whose challenge matches the secret verifier", async () => {
    await client.oauthStart("google");
    const pending = JSON.parse(secrets.get("dusk.account.pending")!);
    const url = new URL(vi.mocked(platform.openExternal).mock.calls[0][0]);
    expect(url.origin + url.pathname).toBe(`${origin}/v1/auth/app/start`);
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ provider: "google", code_challenge_method: "S256", redirect_uri: "duskbot://auth", landing: "page", state: pending.state,
      code_challenge: createHash("sha256").update(pending.verifier).digest("base64url") });
    expect(pending.verifier).toHaveLength(43); expect(pending.state).toHaveLength(32);
  });
  it("leaves pairing links to the connection gate", async () => {
    expect(await client.handleAuthUrl("duskbot://pair?code=abc")).toBe(false);
    expect(isAccountAuthUrl("https://auth")).toBe(false); expect(isAccountAuthUrl("duskbot://auth/other")).toBe(false);
  });
  it("refuses a state mismatch and clears the pending attempt", async () => {
    await client.oauthStart("apple");
    expect(await client.handleAuthUrl("duskbot://auth?code=abc&state=wrong")).toEqual({ outcome: "invalid-state" });
    expect(fetcher).not.toHaveBeenCalled(); expect(secrets.has("dusk.account.pending")).toBe(false);
  });
  it("refuses an old attempt", async () => {
    await client.oauthStart("google"); const pending = JSON.parse(secrets.get("dusk.account.pending")!); pending.at -= 15 * 60_000;
    secrets.set("dusk.account.pending", JSON.stringify(pending));
    expect(await client.handleAuthUrl(`duskbot://auth?code=abc&state=${pending.state}`)).toEqual({ outcome: "invalid-state" }); expect(fetcher).not.toHaveBeenCalled();
  });
  it("exchanges a matching code and persists the grant", async () => {
    await client.oauthStart("google"); const pending = JSON.parse(secrets.get("dusk.account.pending")!);
    fetcher.mockResolvedValueOnce(response(grant()));
    expect(await client.handleAuthUrl(`duskbot://auth?code=abc&state=${pending.state}`)).toEqual({ outcome: "signed-in" });
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toMatchObject({ code: "abc", codeVerifier: pending.verifier, platform: "ios" });
    expect(client.account()).toEqual(grant().account); expect(secrets.has("dusk.account.pending")).toBe(false); expect(secrets.has("dusk.account")).toBe(true);
  });
  it.each(["oauth_denied", "oauth_failed", "oauth_expired", "provider_unavailable", "signup_closed", "identity_taken"])("surfaces provider error %s", async error => {
    await client.oauthStart("google"); const pending = JSON.parse(secrets.get("dusk.account.pending")!);
    expect(await client.handleAuthUrl(`duskbot://auth?error=${error}&state=${pending.state}`)).toEqual({ outcome: error });
    expect(secrets.has("dusk.account.pending")).toBe(false); expect(fetcher).not.toHaveBeenCalled();
  });
  it("clears a pending attempt when code exchange fails", async () => {
    await client.oauthStart("google"); const pending = JSON.parse(secrets.get("dusk.account.pending")!); fetcher.mockRejectedValue(new Error("offline"));
    expect(await client.handleAuthUrl(`duskbot://auth?code=abc&state=${pending.state}`)).toEqual({ outcome: "failed" }); expect(secrets.has("dusk.account.pending")).toBe(false);
  });
});

describe("signed-in actions", () => {
  const restore = async () => { secrets.set("dusk.account", JSON.stringify(stored())); fetcher.mockResolvedValueOnce(response({})); await client.restore(); };
  it("clears local secrets even when sign-out cannot reach the service", async () => {
    await restore(); fetcher.mockRejectedValueOnce(new Error("offline"));
    await client.signOut(); expect(client.account()).toBeNull(); expect(secrets.has("dusk.account")).toBe(false);
    expect(fetcher.mock.calls[1]).toMatchObject([`${origin}/api/cloud/desktop/session`, { method: "DELETE", body: "{}", headers: { authorization: `Bearer ${token}` } }]);
  });
  it.each([`${origin}/dashboard`, "https://other.example/dashboard", `${origin}/dashboard?ok=1`])("validates enrollment destination %s", async dashboardUrl => {
    await restore(); fetcher.mockResolvedValueOnce(response({ enrollToken: "e".repeat(43), dashboardUrl }));
    expect(await client.enrollGrant()).toEqual(dashboardUrl.startsWith(origin) ? { enrollToken: "e".repeat(43), dashboardUrl } : null);
  });
  it("rejects invalid enrollment tokens and signed-out requests", async () => {
    expect(await client.enrollGrant()).toBeNull(); await restore(); fetcher.mockResolvedValueOnce(response({ enrollToken: "bad", dashboardUrl: origin }));
    expect(await client.enrollGrant()).toBeNull();
  });
});

describe("own clouds", () => {
  const signIn = async () => { secrets.set("dusk.account", JSON.stringify(stored())); fetcher.mockResolvedValueOnce(response({})); await client.restore(); fetcher.mockClear(); };
  const listed = (extra = {}) => ({ id: "c0123456789abcdef01234567", name: "Studio", role: "owner", teamId: null, managed: true, status: "ready", origin: "https://d0123456789abcdef0123.dusk.bot", primary: true, ...extra });
  it("lists the account's own clouds from the session, primary first, team and signed-in servers left out", async () => {
    await signIn();
    fetcher.mockResolvedValueOnce(response({ clouds: [listed({ id: "second", primary: false, power: { state: "asleep" } }), listed(), listed({ id: "team", teamId: "t1" }), listed({ id: "server", managed: false }), listed({ id: "member", role: "member" })] }));
    const clouds = await client.clouds();
    expect(clouds?.map((cloud) => [cloud.id, cloud.asleep])).toEqual([["c0123456789abcdef01234567", false], ["second", true]]);
    expect(fetcher.mock.calls[0][0]).toBe(`${origin}/api/cloud/desktop/session`);
  });
  it("drops an origin that is not plain https", async () => {
    await signIn();
    fetcher.mockResolvedValueOnce(response({ clouds: [listed({ origin: "http://d1.dusk.bot" })] }));
    expect((await client.clouds())?.[0]?.origin).toBeNull();
  });
  it("answers null when signed out or the session cannot be read", async () => {
    expect(await client.clouds()).toBeNull();
    await signIn(); fetcher.mockRejectedValueOnce(new TypeError("offline"));
    expect(await client.clouds()).toBeNull();
  });
  it("pairs with a bearer request for that cloud and checks the grant", async () => {
    await signIn();
    const cloud = { id: "c1", origin: "https://d1.dusk.bot" };
    fetcher.mockResolvedValueOnce(response({ cloudContractVersion: 1, origin: cloud.origin, code: "ABCD-EFGH-JKLM", expiresAt: Date.now() + 300_000 }));
    expect(await client.pairCloud(cloud)).toMatchObject({ outcome: "paired", grant: { origin: cloud.origin, code: "ABCD-EFGH-JKLM" } });
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe(`${origin}/api/cloud/desktop/pairing`);
    expect(init).toMatchObject({ method: "POST", body: JSON.stringify({ cloudId: "c1" }), headers: { authorization: `Bearer ${token}` } });
  });
  it.each([
    [{ cloudContractVersion: 1, origin: "https://elsewhere.dusk.bot", code: "ABCD-EFGH-JKLM", expiresAt: Date.now() + 300_000 }],
    [{ cloudContractVersion: 1, origin: "https://d1.dusk.bot", code: "ABCDEFGHJKLM", expiresAt: Date.now() + 300_000 }],
    [{ cloudContractVersion: 1, origin: "https://d1.dusk.bot", code: "ABCD-EFGH-JKLM", expiresAt: Date.now() + 3_600_000 }],
  ])("refuses a grant that does not match: %j", async (answer) => {
    await signIn(); fetcher.mockResolvedValueOnce(response(answer));
    expect(await client.pairCloud({ id: "c1", origin: "https://d1.dusk.bot" })).toEqual({ outcome: "failed" });
  });
  it.each([
    [409, "not_running", "asleep"], [409, "unavailable", "unavailable"], [404, "not_found", "unavailable"], [401, "invalid_token", "signed-out"], [500, "failed", "failed"],
  ])("maps %i %s to %s", async (status, error, outcome) => {
    await signIn(); fetcher.mockResolvedValueOnce(response({ error }, status));
    expect(await client.pairCloud({ id: "c1", origin: "https://d1.dusk.bot" })).toEqual({ outcome });
  });
  it("wakes the primary cloud with a click intent", async () => {
    expect(await client.wakeCloud()).toBe(false);
    await signIn(); fetcher.mockResolvedValueOnce(response({ state: "waking" }));
    expect(await client.wakeCloud()).toBe(true);
    expect(fetcher.mock.calls[0]).toEqual([`${origin}/api/cloud/desktop/wake`, expect.objectContaining({ method: "POST", body: JSON.stringify({ intent: "click" }) })]);
  });
});

describe("delete account", () => {
  const signedIn = async () => { secrets.set("dusk.account", JSON.stringify(stored())); fetcher.mockResolvedValueOnce(response({})); await client.restore(); };
  it("asks the service to delete with this sign-in and the account's email, then forgets the sign-in", async () => {
    await signedIn();
    fetcher.mockResolvedValueOnce(response({ ok: true }));
    expect(await client.deleteAccount()).toBe("deleted");
    const [url, init] = fetcher.mock.calls[1];
    expect(url).toBe(`${origin}/v1/app/delete-account`);
    expect(init).toMatchObject({ method: "POST", headers: { authorization: `Bearer ${token}` } });
    expect(JSON.parse(String(init?.body))).toEqual({ email: "person@example.com" });
    expect(client.account()).toBeNull(); expect(secrets.has("dusk.account")).toBe(false);
  });
  it("keeps everything when the service could not delete, and forgets a sign-in the service no longer knows", async () => {
    await signedIn();
    fetcher.mockResolvedValueOnce(response({ error: "failed" }, 503));
    expect(await client.deleteAccount()).toBe("failed");
    expect(client.account()).toEqual(grant().account); expect(secrets.has("dusk.account")).toBe(true);
    fetcher.mockRejectedValueOnce(new TypeError("offline"));
    expect(await client.deleteAccount()).toBe("failed");
    fetcher.mockResolvedValueOnce(response({ error: "invalid_token" }, 401));
    expect(await client.deleteAccount()).toBe("signed-out");
    expect(client.account()).toBeNull(); expect(secrets.has("dusk.account")).toBe(false);
  });
  it("does nothing signed out", async () => {
    expect(await client.deleteAccount()).toBe("signed-out"); expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("sign in with Apple, native", () => {
  const credential = { identityToken: "header.payload.signature", authorizationCode: "c0de.abc", givenName: " Sam ", familyName: "" };
  const withApple = (answer: () => Promise<typeof credential | null>) => {
    const appleSignIn = vi.fn(async (_hash: string) => answer());
    platform.appleSignIn = appleSignIn;
    client = createMobileAccount({ platform, origin, fetch: fetcher });
    return appleSignIn;
  };

  it("makes a fresh raw nonce and gives Apple its sha-256 hex", async () => {
    const one = await appleNonce(), two = await appleNonce();
    expect(one.raw).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(one.hash).toBe(createHash("sha256").update(one.raw).digest("hex"));
    expect(one.raw).not.toBe(two.raw);
  });

  it("hands Apple the hash, the service the raw nonce, and keeps the session as an email sign-in does", async () => {
    const appleSignIn = withApple(async () => credential);
    fetcher.mockResolvedValueOnce(response(grant()));
    expect(await client.appleNative()).toEqual({ outcome: "signed-in" });
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe(`${origin}/api/cloud/app/sign-in/apple`);
    const sent = JSON.parse(String(init?.body));
    expect(sent).toEqual({ identityToken: credential.identityToken, authorizationCode: credential.authorizationCode, nonce: sent.nonce, givenName: "Sam", deviceName: "p".repeat(100), platform: "ios", appVersion: "0.0.0" });
    expect(appleSignIn.mock.calls[0][0]).toBe(createHash("sha256").update(sent.nonce).digest("hex"));
    expect(client.account()).toEqual(grant().account);
    expect(JSON.parse(secrets.get("dusk.account")!)).toMatchObject({ origin, token, account: grant().account });
  });

  it("says nothing when the person closes Apple's sheet, and asks nothing of the service", async () => {
    withApple(async () => null);
    expect(await client.appleNative()).toEqual({ outcome: "canceled" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    ["invalid_request", 400, "failed"], ["invalid_grant", 400, "failed"], ["signup_closed", 403, "signup-closed"], ["identity_taken", 409, "taken"],
    ["provider_unavailable", 503, "unavailable"], ["rate_limited", 429, "rate-limited"], ["something_new", 500, "failed"],
  ])("turns the service's %s into one problem", async (error, status, outcome) => {
    withApple(async () => credential);
    fetcher.mockResolvedValueOnce(response({ error }, status));
    expect(await client.appleNative()).toEqual({ outcome });
    expect(client.account()).toBeNull(); expect(secrets.has("dusk.account")).toBe(false);
  });

  it("tells apart no connection, a failed sheet and a phone without the native sheet", async () => {
    withApple(async () => credential);
    fetcher.mockRejectedValueOnce(new TypeError("offline"));
    expect(await client.appleNative()).toEqual({ outcome: "offline" });
    withApple(async () => { throw Object.assign(new Error("x"), { code: "failed" }); });
    expect(await client.appleNative()).toEqual({ outcome: "failed" });
    platform.appleSignIn = undefined;
    client = createMobileAccount({ platform, origin, fetch: fetcher });
    expect(await client.appleNative()).toEqual({ outcome: "unavailable" });
  });
});

describe("mobileFace", () => {
  it("keeps an https photo and an avatar choice, and drops anything else", () => {
    expect(mobileFace({ avatarUrl: "https://lh3.googleusercontent.com/a/x", avatar: "g:abc123" })).toEqual({ avatarUrl: "https://lh3.googleusercontent.com/a/x", avatar: "g:abc123" });
    expect(mobileFace({ avatarUrl: "http://example.test/a.png", avatar: "<b>" })).toEqual({});
    expect(mobileFace({ avatarUrl: "https://u:p@example.test/a.png", avatar: "drawn" })).toEqual({ avatar: "drawn" });
    expect(mobileFace(null)).toEqual({});
  });
});

describe("phone code", () => {
  it("logs in with a desktop's code: one request with the code and this phone, no email step", async () => {
    fetcher.mockResolvedValueOnce(response(grant()));
    expect(await client.phoneCode(" abcd-efgh ")).toEqual({ outcome: "signed-in" });
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe(`${origin}/api/cloud/app/sign-in/phone`);
    expect(JSON.parse(String(init?.body))).toMatchObject({ code: "ABCDEFGH", platform: "ios", appVersion: "0.0.0" });
    expect(client.account()).toEqual(grant().account);
    expect(secrets.has("dusk.account")).toBe(true);
  });
  it("ends the sign-in this phone held before once the new one is kept", async () => {
    secrets.set("dusk.account", JSON.stringify(stored({ token: `omc_${"o".repeat(43)}` })));
    await client.cached();
    fetcher.mockResolvedValueOnce(response(grant())).mockResolvedValueOnce(response({ ok: true }));
    expect((await client.phoneCode("ABCDEFGH")).outcome).toBe("signed-in");
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    expect(fetcher.mock.calls[1]![1]).toMatchObject({ method: "DELETE", headers: { authorization: `Bearer omc_${"o".repeat(43)}` } });
  });
  it.each([
    [{ error: "invalid_code" }, 400, "wrong-code"], [{ error: "expired" }, 410, "expired"], [{ error: "used" }, 409, "used"],
    [{ error: "rate_limited" }, 429, "limited"], [{ error: "failed" }, 500, "failed"],
  ])("says why a code did not log in: %o", async (body, status, outcome) => {
    fetcher.mockResolvedValueOnce(response(body, status));
    expect(await client.phoneCode("ABCDEFGH")).toEqual({ outcome });
    expect(client.account()).toBeNull();
  });
  it("offline, and a code of the wrong shape never reaches the service", async () => {
    fetcher.mockRejectedValueOnce(new TypeError("offline"));
    expect(await client.phoneCode("ABCDEFGH")).toEqual({ outcome: "offline" });
    expect(await client.phoneCode("ABCD-EFGH-JKLM")).toEqual({ outcome: "wrong-code" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
