// phone push for workspaces that hold no APNs or FCM keys of their own. the phone app's keys live here, once, instead of
// on every person's computer and server.
//
// what it sees: the device token, apns or fcm, the bot's name and the ids a tap opens (notification, bot, thread,
// room). never a title, a message or anything a person wrote; it keeps nothing and logs no token.
import { createPrivateKey, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import { connect, constants } from "node:http2";

const SERVICES = new Set(["apns", "fcm"]);
const TOKEN = /^[\w:.-]{8,4096}$/;
const ID = /^[\w:.-]{1,128}$/;
const KIND = /^[a-z][a-z0-9_-]{0,31}$/;
const PER_TOKEN_PER_MINUTE = 60;
const PER_IP_PER_MINUTE = 600;

function jwt(header, claims, key) {
  const input = [header, claims].map((part) => Buffer.from(JSON.stringify(part)).toString("base64url")).join(".");
  return `${input}.${sign("sha256", Buffer.from(input), { key, dsaEncoding: "ieee-p1363" }).toString("base64url")}`;
}

function collapseId(threadId) {
  let value = "";
  for (const character of threadId) {
    if (Buffer.byteLength(value + character) > 64) break;
    value += character;
  }
  return value;
}

/** the message a workspace asks to push, or null; the bot's name is cut to what a lock screen shows */
/** The Android channel a quiet push goes to; the phone app creates it at low importance, which makes no sound. */
const QUIET_CHANNEL = "dusk-quiet";

export function pushMessage(value) {
  if (!value || typeof value !== "object") return null;
  const { id, kind, botId, threadId, groupId } = value;
  if (![id, botId, threadId].every((one) => typeof one === "string" && ID.test(one)) || typeof kind !== "string" || !KIND.test(kind)) return null;
  if (groupId !== undefined && (typeof groupId !== "string" || !ID.test(groupId))) return null;
  const botName = typeof value.botName === "string" ? [...value.botName].filter((char) => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127).join("").trim().slice(0, 80) : "";
  if (!botName) return null;
  return { id, kind, botId, botName, threadId, ...(groupId !== undefined ? { groupId } : {}), ...(value.silent === true ? { silent: true } : {}) };
}

export function createPushRelay({ env = process.env, now = Date.now, fetch: fetchImpl = fetch, http2Connect = connect, readFile = readFileSync, log = () => {} } = {}) {
  const services = [];
  let apns, fcm;
  const { DUSK_APNS_KEY_FILE: keyFile, DUSK_APNS_KEY_ID: keyId, DUSK_APNS_TEAM_ID: teamId, DUSK_APNS_TOPIC: topic } = env;
  if (keyFile || keyId || teamId || topic) {
    try {
      if (!keyFile || !keyId || !teamId || !topic) throw new Error("incomplete");
      const key = createPrivateKey(readFile(keyFile));
      if (key.asymmetricKeyType !== "ec" || key.asymmetricKeyDetails?.namedCurve !== "prime256v1") throw new Error("invalid key");
      apns = { key, keyId, teamId, topic };
      services.push("apns");
    } catch {
      log("push relay: could not load APNs credentials; APNs is off");
    }
  }
  if (env.DUSK_FCM_SERVICE_ACCOUNT_FILE) {
    try {
      const account = JSON.parse(readFile(env.DUSK_FCM_SERVICE_ACCOUNT_FILE).toString());
      if (![account.project_id, account.client_email, account.private_key, account.token_uri].every((one) => typeof one === "string" && one)) throw new Error("invalid account");
      const key = createPrivateKey(account.private_key);
      if (key.asymmetricKeyType !== "rsa") throw new Error("invalid key");
      fcm = { key, projectId: account.project_id, email: account.client_email, tokenUri: account.token_uri };
      services.push("fcm");
    } catch {
      log("push relay: could not load FCM credentials; FCM is off");
    }
  }

  let providerToken;
  const sessions = new Map();
  function apnsSession(origin) {
    const known = sessions.get(origin);
    if (known && !known.closed && !known.destroyed) return known;
    const session = http2Connect(origin);
    sessions.set(origin, session);
    const discard = () => { if (sessions.get(origin) === session) sessions.delete(origin); };
    session.on("error", () => { discard(); session.destroy(); });
    session.on("close", discard);
    session.on("goaway", () => { discard(); session.close(); });
    session.unref();
    return session;
  }

  function sendApns(token, environment, message) {
    if (!providerToken || now() - providerToken.createdAt >= 50 * 60_000) {
      providerToken = { value: jwt({ alg: "ES256", kid: apns.keyId }, { iss: apns.teamId, iat: Math.floor(now() / 1000) }, apns.key), createdAt: now() };
    }
    const origin = env.DUSK_APNS_HOST ?? (environment === "sandbox" ? "https://api.sandbox.push.apple.com" : "https://api.push.apple.com");
    const session = apnsSession(origin);
    return new Promise((resolve) => {
      const request = session.request({
        ":method": "POST", ":path": `/3/device/${token}`, authorization: `bearer ${providerToken.value}`, "apns-topic": apns.topic,
        "apns-push-type": "alert", "apns-priority": "10", "apns-collapse-id": collapseId(message.threadId),
      });
      let status = 0, body = "";
      const finish = (outcome) => { clearTimeout(timer); resolve(outcome); };
      const timer = setTimeout(() => { finish("failed"); request.close(constants.NGHTTP2_CANCEL); }, 10_000);
      request.setEncoding("utf8");
      request.on("response", (headers) => { status = Number(headers[":status"]); });
      request.on("data", (chunk) => { body += chunk; });
      request.on("error", () => finish("failed"));
      request.on("close", () => finish("failed"));
      request.on("end", () => {
        if (status === 200) return finish("sent");
        if (status === 410) return finish("gone");
        let reason;
        try { reason = JSON.parse(body).reason; } catch {}
        finish(status === 400 && (reason === "BadDeviceToken" || reason === "DeviceTokenNotForTopic") ? "gone" : "failed");
      });
      const { botName, silent, ...data } = message;
      request.end(JSON.stringify({ aps: { alert: { title: botName, body: "New message" }, ...(silent ? {} : { sound: "default" }), "thread-id": message.threadId }, omb: data }));
    });
  }

  let accessToken, exchange;
  async function fcmToken() {
    if (accessToken && now() < accessToken.expiresAt - 5 * 60_000) return accessToken.value;
    exchange ??= (async () => {
      const at = now(), iat = Math.floor(at / 1000);
      const assertion = jwt({ alg: "RS256", typ: "JWT" }, { iss: fcm.email, scope: "https://www.googleapis.com/auth/firebase.messaging", aud: fcm.tokenUri, iat, exp: iat + 3600 }, fcm.key);
      const response = await fetchImpl(fcm.tokenUri, {
        method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }), signal: AbortSignal.timeout(10_000),
      });
      const answer = response.ok ? await response.json() : null;
      if (typeof answer?.access_token !== "string" || !answer.access_token || !(answer.expires_in > 0)) throw new Error("token exchange failed");
      accessToken = { value: answer.access_token, expiresAt: at + answer.expires_in * 1000 };
      return accessToken.value;
    })().finally(() => { exchange = undefined; });
    return exchange;
  }

  async function sendFcm(token, message) {
    const access = await fcmToken();
    const { botName, silent, ...data } = message;
    const response = await fetchImpl(`${env.DUSK_FCM_HOST ?? "https://fcm.googleapis.com"}/v1/projects/${encodeURIComponent(fcm.projectId)}/messages:send`, {
      method: "POST", headers: { authorization: `Bearer ${access}`, "content-type": "application/json" },
      body: JSON.stringify({ message: { token, notification: { title: botName, body: "New message" }, data, android: { collapse_key: message.threadId, priority: "high", ...(silent ? { notification: { channel_id: QUIET_CHANNEL } } : {}) } } }),
      signal: AbortSignal.timeout(10_000),
    });
    if (response.status === 200) return "sent";
    if (response.status === 404) return "gone";
    const error = (await response.json().catch(() => null))?.error;
    if (Array.isArray(error?.details) && error.details.some((detail) => detail?.errorCode === "UNREGISTERED")) return "gone";
    if (response.status === 400 && error?.status === "INVALID_ARGUMENT" && /registration[\s_-]*token/i.test(String(error.message ?? ""))) return "gone";
    return "failed";
  }

  const recent = new Map();
  function allowed(key, limit) {
    const since = now() - 60_000;
    const list = (recent.get(key) ?? []).filter((at) => at > since);
    if (list.length >= limit) { recent.set(key, list); return false; }
    list.push(now());
    recent.set(key, list);
    if (recent.size > 50_000) for (const [one, times] of recent) if (!times.some((at) => at > since)) recent.delete(one);
    return true;
  }

  return {
    services,
    /** GET /v1/push says which services it delivers; POST /v1/push {service, token, environment?, message} sends one */
    async route(req, res, { method, readJson, send, fail, ip }) {
      if (method === "GET") return send(res, 200, { services });
      if (method !== "POST") return fail(res, 405, "method not allowed");
      const body = await readJson(req, 16_384);
      const service = SERVICES.has(body?.service) ? body.service : null;
      const token = typeof body?.token === "string" && TOKEN.test(body.token) ? body.token : null;
      const environment = body?.environment === "sandbox" ? "sandbox" : "production";
      const message = pushMessage(body?.message);
      if (!service || !token || !message) return fail(res, 400, "service, token and message are required", "invalid");
      if (!services.includes(service)) return fail(res, 503, `this relay has no ${service === "apns" ? "APNs" : "FCM"} keys`, "not_configured");
      if (!allowed(`ip:${ip}`, PER_IP_PER_MINUTE) || !allowed(`token:${token}`, PER_TOKEN_PER_MINUTE)) return fail(res, 429, "too many pushes", "rate_limited");
      let outcome;
      try { outcome = service === "apns" ? await sendApns(token, environment, message) : await sendFcm(token, message); }
      catch { outcome = "failed"; }
      return send(res, 200, { outcome });
    },
  };
}
