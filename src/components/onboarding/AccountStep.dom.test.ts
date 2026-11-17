// @vitest-environment happy-dom
import { act, createElement, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { AccountStep } from "./AccountStep";
import { funnelAccount, type FunnelAccount, type FunnelAccountState } from "./funnel-account";

vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function fakeAccount() {
  let current: FunnelAccountState = { signedIn: true, email: "ada@example.com", required: false, browser: false };
  const listeners = new Set<() => void>();
  const account: FunnelAccount = {
    state: async () => current,
    initialProviders: ["google", "apple"],
    providers: async () => ["google", "apple"],
    emailStart: vi.fn(), emailVerify: vi.fn(), emailCancel: vi.fn(), browser: vi.fn(), cancelBrowser: vi.fn(),
    signOut: vi.fn(async () => { current = { signedIn: false, required: false, browser: false }; listeners.forEach((listener) => listener()); }),
    onChange: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
  };
  return account;
}

function Host({ account }: { account: FunnelAccount }) {
  const [known, setKnown] = useState<FunnelAccountState | null>(null);
  useEffect(() => {
    const read = () => void account.state().then(setKnown);
    read();
    return account.onChange(read);
  }, [account]);
  return known && createElement(AccountStep, { account, known, onDone: () => {}, onSkip: null });
}

it("signed in, Use a different account signs out and shows the sign-in choices again", async () => {
  const account = fakeAccount();
  const host = document.createElement("div");
  const root = createRoot(host);
  await act(async () => root.render(createElement(Host, { account })));
  expect(host.textContent).toContain("ada@example.com");
  const change = host.querySelector<HTMLButtonElement>("[data-funnel-account-switch]")!;
  expect(change.textContent).toBe("Use a different account");
  await act(async () => change.click());
  expect(account.signOut).toHaveBeenCalledOnce();
  expect(host.querySelector("[data-funnel-provider=google]")).not.toBeNull();
  expect(host.querySelector("[data-funnel-provider=apple]")).not.toBeNull();
  expect(host.querySelector("input[type=email]")).not.toBeNull();
  expect(host.textContent).not.toContain("ada@example.com");
  await act(async () => root.unmount());
});

it("no way to sign out over this bridge, so no Use a different account", async () => {
  const account = { ...fakeAccount(), signOut: undefined };
  const host = document.createElement("div");
  const root = createRoot(host);
  await act(async () => root.render(createElement(Host, { account })));
  expect(host.querySelector("[data-funnel-account-switch]")).toBeNull();
  await act(async () => root.unmount());
});

it("both bridges sign out through the cloud account, which the gate's state follows", async () => {
  const signOut = vi.fn(async () => ({}));
  const cloud = { signOut, state: vi.fn(), begin: vi.fn(), cancel: vi.fn(), onState: vi.fn(), signInStart: vi.fn(), signInVerify: vi.fn() };
  const gate = { state: vi.fn(), signInStart: vi.fn(), signInVerify: vi.fn(), signInCancel: vi.fn(), browser: vi.fn(), cancel: vi.fn(), reopen: vi.fn(), onChange: vi.fn() };
  await funnelAccount({ accountGate: gate, cloudAccount: cloud } as never)!.signOut!();
  await funnelAccount({ cloudAccount: cloud } as never)!.signOut!();
  expect(signOut).toHaveBeenCalledTimes(2);
  expect(funnelAccount({ accountGate: gate } as never)!.signOut).toBeUndefined();
});
