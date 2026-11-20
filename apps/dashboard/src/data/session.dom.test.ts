// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api, ApiError } from "../lib/api";
import { WorkspaceGate } from "../pages/common";
import { SessionProvider, useSession } from "./session";
import { useAccountUsage } from "./usage";
import { CloudDataProvider, useCloud } from "./cloud";
import { fixtureAccount, fixtureBilling, fixtureCatalog } from "./fixtures";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let session: ReturnType<typeof useSession>;
let usage: ReturnType<typeof useAccountUsage>;
let cloud: ReturnType<typeof useCloud>;
const account = { id: "fixture-account", email: "person@example.test" };

function Probe() { session = useSession(); return null; }
function UsageProbe() { usage = useAccountUsage(); return null; }
function CloudProbe() { cloud = useCloud(); return null; }

beforeEach(() => {
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: vi.fn() });
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  vi.spyOn(api, "me").mockResolvedValue({ account });
  vi.spyOn(api, "workspaces").mockResolvedValue({ workspaces: [] });
});
afterEach(async () => { if (root) await act(async () => root.unmount()); document.body.innerHTML = ""; vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function render(children?: ReactNode) {
  const host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  await act(async () => root.render(createElement(SessionProvider, { children: [createElement(Probe, { key: "probe" }), children] })));
  return host;
}

test.each([new TypeError("Failed to fetch"), new ApiError("Unavailable", 503, null)])("account outages preserve the unresolved session and can be retried: %s", async (error) => {
  vi.mocked(api.me).mockRejectedValueOnce(error);
  await render();
  expect(session.account).toBeUndefined();
  expect(session.accountError).toBe(error.message);
  expect(api.workspaces).not.toHaveBeenCalled();
  await act(async () => session.retryAccount());
  expect(session.account).toEqual(account);
  expect(session.accountError).toBeNull();
});

test("only an unauthorized account check signs out", async () => {
  vi.mocked(api.me).mockRejectedValueOnce(new ApiError("Sign in", 401, null));
  await render();
  expect(session.account).toBeNull();
  expect(session.accountError).toBeNull();
});

test("the workspace gate shows list failures and Retry loads the list again", async () => {
  vi.mocked(api.workspaces).mockRejectedValueOnce(new ApiError("Workspace list unavailable", 503, null));
  const host = await render(createElement(WorkspaceGate, { children: () => null }));
  expect(session.account).toEqual(account);
  expect(host.querySelector('[role="alert"]')?.textContent).toBe("Workspace list unavailable");
  expect(host.querySelector('[aria-busy="true"]')).toBeNull();
  await act(async () => host.querySelector("button")!.click());
  expect(api.workspaces).toHaveBeenCalledTimes(2);
  expect(session.workspacesError).toBeNull();
  expect(host.textContent).toContain("connect your first workspace");
});

test("an unauthorized workspace list signs out", async () => {
  vi.mocked(api.workspaces).mockRejectedValueOnce(new ApiError("Sign in", 401, null));
  await render();
  expect(session.account).toBeNull();
  expect(session.workspacesError).toBeNull();
});

test("usage Retry reloads failed workspace reports", async () => {
  vi.mocked(api.workspaces).mockResolvedValue({ workspaces: [{ id: "fixture-workspace" }] as Awaited<ReturnType<typeof api.workspaces>>["workspaces"] });
  vi.spyOn(api, "workspace").mockRejectedValue(new ApiError("Report unavailable", 503, null));
  await render(createElement(UsageProbe, { key: "usage" }));
  expect(usage.error).toBe("Report unavailable");
  const attempts = vi.mocked(api.workspace).mock.calls.length;
  await act(async () => usage.refresh());
  expect(vi.mocked(api.workspace).mock.calls.length).toBeGreaterThan(attempts);
});


test("cloud Retry requests the catalog again after a network failure", async () => {
  vi.spyOn(api, "catalog").mockRejectedValueOnce(new ApiError("Offline", 0, "offline")).mockResolvedValue(fixtureCatalog);
  vi.spyOn(api, "overview").mockResolvedValue({ billing: fixtureBilling("mac"), clouds: [] });
  vi.spyOn(api, "account").mockResolvedValue(fixtureAccount("mac"));
  vi.spyOn(api, "connections").mockResolvedValue({ byWorkspace: {}, pending: {}, available: {}, at: {} });
  await render(createElement(CloudDataProvider, { signedIn: true, children: createElement(CloudProbe) }));
  expect(cloud.error).toBe("Offline");
  await act(async () => cloud.refresh());
  expect(api.catalog).toHaveBeenCalledTimes(2);
  expect(cloud.error).toBeNull();
  expect(cloud.catalog).toEqual(fixtureCatalog);
});

test("a second buy click while the first checkout is on its way asks for no second page, and a failure lets the next click try again", async () => {
  vi.spyOn(api, "catalog").mockResolvedValue(fixtureCatalog);
  vi.spyOn(api, "overview").mockResolvedValue({ billing: fixtureBilling("mac"), clouds: [] });
  vi.spyOn(api, "account").mockResolvedValue(fixtureAccount("mac"));
  vi.spyOn(api, "connections").mockResolvedValue({ byWorkspace: {}, pending: {}, available: {}, at: {} });
  let answer = (_value: unknown) => {}, refuse = (_error: unknown) => {};
  vi.spyOn(api, "checkout").mockImplementation(() => new Promise((resolve, reject) => { answer = resolve as typeof answer; refuse = reject; }));
  const assign = vi.fn();
  vi.stubGlobal("location", { ...window.location, assign, reload: vi.fn() });
  await render(createElement(CloudDataProvider, { signedIn: true, children: createElement(CloudProbe) }));
  const req = { kind: "plan" as const, source: "dash_license" as const, selection: { license: "starter" as const, members: 1, desktop: "none" as const, size: null, region: "eu-central", interval: "month" as const }, bundle: null };
  let first: boolean | undefined, second: boolean | undefined;
  void cloud.checkout(req).then((ok) => { first = ok; }); void cloud.checkout(req).then((ok) => { second = ok; });
  expect(api.checkout).toHaveBeenCalledTimes(1);
  await act(async () => refuse(new ApiError("Try again later.", 429, "rate_limited")));
  expect([first, second]).toEqual([false, false]);
  expect(cloud.error).toBe("Try again later.");
  void cloud.checkout(req);
  expect(api.checkout).toHaveBeenCalledTimes(2);
  await act(async () => answer({ url: "https://test.checkout.dodopayments.com/session/one", id: "chk_1" }));
  expect(assign).toHaveBeenCalledExactlyOnceWith("https://test.checkout.dodopayments.com/session/one");
  void cloud.checkout(req);
  expect(api.checkout).toHaveBeenCalledTimes(2);
});
