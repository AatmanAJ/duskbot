import { loginSealTarget, normalizeLoginHost } from "../../shared/login-host";
import type { LoginBots, LoginSummary, OnePasswordStatus } from "../../shared/logins";
import type { ComputerHelpRef } from "../../shared/wire";
import { sendSealed } from "@/lib/sealed-send";
import { api } from "@/state/store";

/** What the person typed into a login form. Kept only until it is sent. */
export interface LoginFieldsInput {
  username: string;
  password: string;
  totp: string;
}

export async function listLogins(): Promise<{ logins: LoginSummary[]; onePassword: OnePasswordStatus }> {
  return await api<{ logins: LoginSummary[]; onePassword: OnePasswordStatus }>("/api/logins");
}

/** The server checks the token reaches 1Password before keeping it, and never sends it back. A password, a 2FA key or
 * the token leaves this app only sealed for the server (src/lib/sealed-send.ts). */
export async function connectOnePassword(token: string): Promise<OnePasswordStatus> {
  return (await sendSealed("onepassword.connect", [], { token: token.trim() }, (sealed) =>
    api<{ onePassword: OnePasswordStatus }>("/api/logins/1password", { method: "POST", body: JSON.stringify(sealed ? { sealed } : { token }) }))).onePassword;
}

export async function refreshOnePassword(): Promise<OnePasswordStatus> {
  return (await api<{ onePassword: OnePasswordStatus }>("/api/logins/1password/refresh", { method: "POST", body: "{}" })).onePassword;
}

export async function disconnectOnePassword(): Promise<OnePasswordStatus> {
  return (await api<{ onePassword: OnePasswordStatus }>("/api/logins/1password", { method: "DELETE" })).onePassword;
}

const loginSecrets = (password: string | undefined, totp: string | undefined): Record<string, string> =>
  ({ ...(password ? { password } : {}), ...(totp?.trim() ? { totp } : {}) });

export async function addLogin(site: string, fields: LoginFieldsInput, bots: LoginBots, exactHost = false): Promise<LoginSummary> {
  const target = loginSealTarget(normalizeLoginHost(site) ?? site.trim(), fields.username);
  return (await sendSealed("login.create", target, loginSecrets(fields.password, fields.totp), (sealed) => api<{ login: LoginSummary }>("/api/logins", {
    method: "POST",
    body: JSON.stringify({ site, username: fields.username, ...(sealed ? { sealed } : {}), bots, ...(exactHost ? { exactHost } : {}) }),
  }))).login;
}

export async function changeLogin(id: string, change: { password?: string; totp?: string; removeTotp?: boolean; bots?: LoginBots; exactHost?: boolean }): Promise<LoginSummary> {
  return (await sendSealed("login.update", [id], loginSecrets(change.password, change.removeTotp ? undefined : change.totp), (sealed) =>
    api<{ login: LoginSummary }>(`/api/logins/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({
        ...(sealed ? { sealed } : {}),
        ...(change.removeTotp ? { totp: null } : {}),
        ...(change.bots ? { bots: change.bots } : {}),
        ...(change.exactHost === undefined ? {} : { exactHost: change.exactHost }),
      }),
    }))).login;
}

/** Which bots may use the logins in one 1Password vault. */
export async function grantVault(vaultId: string, bots: LoginBots): Promise<OnePasswordStatus> {
  return (await api<{ onePassword: OnePasswordStatus }>(`/api/logins/1password/vaults/${encodeURIComponent(vaultId)}`, {
    method: "PATCH",
    body: JSON.stringify({ bots }),
  })).onePassword;
}

export async function deleteLogin(id: string): Promise<void> {
  await api(`/api/logins/${encodeURIComponent(id)}`, { method: "DELETE" });
}

type CardRef = Pick<ComputerHelpRef, "botId" | "threadId" | "messageId">;

const cardSavePath = (ref: CardRef) => `/api/bots/${encodeURIComponent(ref.botId)}/sign-in-cards/${encodeURIComponent(ref.messageId)}/save-login`;

/** Where a login saved from the card fills: its site, and a sign-in page on another site the browser shows now, which
 * the person may add. */
export async function cardSaveTarget(ref: CardRef): Promise<{ site: string; signInHost?: string }> {
  return await api<{ site: string; signInHost?: string }>(`${cardSavePath(ref)}?threadId=${encodeURIComponent(ref.threadId)}`);
}

export async function saveLoginFromCard(ref: CardRef, fields: LoginFieldsInput, signInHost?: string): Promise<void> {
  await sendSealed("login.card", [ref.botId, ref.threadId, ref.messageId], loginSecrets(fields.password, fields.totp), (sealed) => api(cardSavePath(ref), {
    method: "POST",
    body: JSON.stringify({ threadId: ref.threadId, username: fields.username, ...(sealed ? { sealed } : {}), ...(signInHost ? { signInHost } : {}) }),
  }));
}
