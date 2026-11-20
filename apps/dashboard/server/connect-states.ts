// An app sign-in started from the website comes back to its apps page with a one-time `connect` state. Security: the
// state is random, bound to the account, workspace and app it was opened for, lives ten minutes and is taken once; it
// carries no token and the website stores none: the sign-in's result lives with the app's provider and the workspace.
import { randomBytes } from "node:crypto";
import { CONNECT_CALLBACK_PATH } from "../../../shared/dashboard-protocol.ts";

export const CONNECT_STATE_MS = 10 * 60_000;
const MAX_OPEN = 5_000;

export interface ConnectState { accountId: string; workspaceId: string; slug: string; expiresAt: number }

export function createConnectStates(pagesUrl: string, now: () => number = Date.now) {
  const open = new Map<string, ConnectState>();
  const sweep = () => { for (const [state, entry] of open) if (entry.expiresAt <= now()) open.delete(state); };
  return {
    /** a new state for this account's sign-in to `slug` on the workspace; answers the callback the sign-in returns to */
    open(accountId: string, workspaceId: string, slug: string): string {
      sweep();
      if (open.size >= MAX_OPEN) open.delete(open.keys().next().value!);
      const state = randomBytes(32).toString("base64url");
      open.set(state, { accountId, workspaceId, slug, expiresAt: now() + CONNECT_STATE_MS });
      return `${pagesUrl}${CONNECT_CALLBACK_PATH}?connect=${state}`;
    },
    /** the sign-in this state was opened for, once, and only for the account that opened it */
    take(state: string, accountId: string): ConnectState | null {
      const entry = open.get(state);
      if (!entry || entry.accountId !== accountId) return null;
      open.delete(state);
      return entry.expiresAt > now() ? entry : null;
    },
  };
}
