// The Vault for a test: one saved login for the fake portal, typed by the real fill_login code through whatever page it is handed.
import { fillLogin, type FillCandidate } from "../../login-fill.ts";
import type { LoginInput } from "../ports.ts";
import type { ExpensePortal } from "./expense-portal.ts";

export interface TestVault {
  /** The replayer's sign-in: fill_login on the page in front. */
  signIn(site: string): Promise<{ ok: boolean; text: string }>;
  /** How many times a login was asked for, and for which sites. */
  readonly asked: string[];
}

export function testVault(input: LoginInput, portal: ExpensePortal, { saved = true, password = portal.password } = {}): TestVault {
  const asked: string[] = [];
  const login: FillCandidate = {
    id: "login-portal", site: "127.0.0.1", hosts: ["127.0.0.1"], exactHost: true, username: portal.user, source: "settings",
    secrets: async () => ({ password, totp: null }),
  };
  return {
    asked,
    signIn: async (site) => {
      asked.push(site);
      const outcome = await fillLogin({
        candidates: async (host) => (saved && host === "127.0.0.1" ? [login] : []),
        available: async () => [],
      }, { ...input, remember: () => {} });
      return { ok: outcome.ok, text: outcome.text };
    },
  };
}
