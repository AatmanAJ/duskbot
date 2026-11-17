import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";

import type { DemoDraft } from "../../shared/demo-recording.ts";
import { ExpensePortal } from "../demo-recorder/testing/expense-portal.ts";
import { FakeBrowser } from "../demo-recorder/testing/fake-browser.ts";
import { EXPENSES, INBOX, showOneExpense } from "../demo-recorder/testing/scenario.ts";
import { json, readBody } from "../harness/http.ts";
import { createShowItOnce } from "../host/show-it-once.ts";
import { requiredScope, type RequestAuth } from "../request-auth.ts";
import { createDemoRecorderRoutes } from "./demo-recorder.ts";
import { dispatchRoutes } from "./table.ts";

const cleanup: Array<() => unknown> = [];
afterEach(async () => { for (const step of cleanup.splice(0).reverse()) await step(); });

async function serve() {
  const portal = await ExpensePortal.start();
  const browser = new FakeBrowser({ scriptsOnNewDocuments: true });
  const botId = `bot-${randomUUID().slice(0, 8)}`;
  const state = { held: true, saved: [] as string[], routines: [] as Array<{ name: string; prompt: string }> };
  const recorder = createShowItOnce({
    browser: async () => ({ session: "s", spec: { command: "browser", env: {} }, env: {} }),
    browserHeld: () => state.held,
    browserPort: () => browser.port(),
    computerHeld: () => false,
    boxChrome: async () => null,
    openBox: async () => ({ refusal: "none" }),
    namer: () => null,
    saveSkill: (_botId, skill) => { state.saved.push(skill.name); return { name: skill.name }; },
    createRoutine: (_botId, routine) => { state.routines.push(routine); return { id: "routine-7" }; },
    changed: () => {},
    scrub: (text) => text,
    watchMs: 60_000,
  });
  const routes = [createDemoRecorderRoutes({ recorder, botExists: (id) => id === botId })];
  const server: Server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const auth = { kind: "loopback", scopes: ["admin"] } as unknown as RequestAuth;
    if (!await dispatchRoutes(routes, { req, res, url, path: url.pathname, method: req.method ?? "GET", auth, json, readBody })) json(res, 404, { from: "inline routes" });
  });
  cleanup.push(() => portal.close(), () => browser.close(), () => recorder.discard(botId), () => new Promise((done) => server.close(done)));
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/bots/${botId}/demo-recording`;
  const call = async (method: string, path = "", body?: unknown) => {
    const response = await fetch(`${base}${path}`, { method, ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json() as { draft?: DemoDraft; error?: string; code?: string; skill?: string; routineId?: string; from?: string } };
  };
  return { portal, browser, botId, state, call, base };
}

describe("Show it once routes", () => {
  it("are an admin's, like every route that changes what a bot can do", () => {
    for (const [method, path] of [["GET", ""], ["POST", "/start"], ["POST", "/save"], ["PATCH", "/steps/s4"], ["DELETE", "/steps/s4"]] as const) {
      expect(requiredScope(method, `/api/bots/bot-1/demo-recording${path}`)).toBe("admin");
    }
  });

  it("record, show the list as it is edited, and save it as a skill and a routine", async () => {
    const { call, portal, browser, state } = await serve();
    expect((await call("GET")).body.draft).toMatchObject({ state: "idle", steps: [] });
    const started = await call("POST", "/start", { place: "browser" });
    expect(started.status).toBe(200);
    expect(started.body.draft).toMatchObject({ state: "recording", place: "browser" });
    await showOneExpense(browser, portal, EXPENSES[0]!, { wander: true });
    const stopped = (await call("POST", "/stop")).body.draft!;
    expect(stopped.state).toBe("review");
    expect(stopped.steps).toHaveLength(14);

    const help = stopped.steps.find((step) => step.target?.name === "Help")!;
    expect((await call("DELETE", `/steps/${help.id}`)).body.draft!.steps).toHaveLength(13);
    const tick = stopped.steps.find((step) => step.kind === "check")!;
    expect((await call("PATCH", `/steps/${tick.id}`, { blank: "billable" })).body.draft!.blanks.map((blank) => blank.name)).toContain("billable");
    const notes = stopped.steps.find((step) => step.blank === "notes")!;
    expect((await call("PATCH", `/steps/${notes.id}`, { blank: null })).body.draft!.blanks.map((blank) => blank.name)).not.toContain("notes");
    expect((await call("PATCH", `/steps/${notes.id}`, { value: "Filed by my bot" })).body.draft!.steps.find((step) => step.id === notes.id)!.value).toBe("Filed by my bot");
    expect((await call("POST", "/blanks", { from: "amount_usd", to: "amount" })).body.draft!.blanks.map((blank) => blank.name)).toContain("amount");
    expect((await call("POST", "/title", { title: "File an expense report" })).body.draft!.title).toBe("File an expense report");
    expect((await call("GET")).body.draft).toMatchObject({ state: "review", title: "File an expense report" });

    const saved = await call("POST", "/save", { as: "routine", folder: INBOX });
    expect(saved.status).toBe(201);
    expect(saved.body).toEqual({ skill: "file-an-expense-report", routineId: "routine-7" });
    expect(state.saved).toEqual(["file-an-expense-report"]);
    expect(state.routines[0]!.prompt).toContain(`folder ${JSON.stringify(INBOX)}`);
    expect((await call("GET")).body.draft).toMatchObject({ state: "idle" });
  });

  it("answer a refusal with its code, and a request they cannot read with 400", async () => {
    const { call, state, base, botId } = await serve();
    state.held = false;
    const refused = await call("POST", "/start", { place: "browser" });
    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({ code: "not-held" });
    expect((await call("POST", "/start", { place: "the moon" })).status).toBe(400);
    expect((await call("POST", "/save", { as: "skill" })).body).toMatchObject({ code: "save-failed" });
    expect((await call("POST", "/save", { as: "routine", folder: "/no/such/folder/here" })).body).toMatchObject({ code: "no-folder" });
    expect((await call("PATCH", "/steps/s4", { blank: "x", value: "y" })).status).toBe(400);
    expect((await call("PATCH", "/steps/s4", { blank: "amount" })).body).toMatchObject({ code: "invalid" });
    expect((await call("POST", "/blanks", { from: "a", to: "b" })).body).toMatchObject({ code: "invalid" });
    expect((await call("PUT", "/start")).status).toBe(405);
    expect((await call("POST", "/discard")).body.draft).toMatchObject({ state: "idle" });
    const other = await fetch(base.replace(botId, "bot-unknown"));
    expect(other.status).toBe(404);
    const elsewhere = await fetch(`${base}/steps/not-a-step`);
    expect(await elsewhere.json()).toEqual({ from: "inline routes" });
  });
});
