import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { launchVerificationServer, type VerificationServer } from "../scripts/control-dusk.ts";

describe("missions through an isolated HTTP fixture", () => {
  let fixture: VerificationServer;
  const api = async (method: string, path: string, body?: unknown) => {
    const response = await fetch(`${fixture.info.url}${path}`, {
      method,
      headers: { "content-type": "application/json", origin: fixture.info.url },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json() as any };
  };

  beforeAll(async () => {
    fixture = await launchVerificationServer(process.env, undefined, undefined, undefined, { scripted: true });
  }, 60_000);
  afterAll(async () => { await fixture?.close(); });

  it("runs one brief in three lanes and reports each lane's state, reply, teammates and timeline", async () => {
    const bot = async (name: string) => (await api("POST", "/api/bots", { name })).body.bot;
    const [ada, ben, cy, dee] = [await bot("Ada"), await bot("Ben"), await bot("Cy"), await bot("Dee")];
    const gate = join(fixture.info.dataDir, "dee-gate");
    writeFileSync(join(fixture.info.dataDir, "room-plan.json"), JSON.stringify({
      [ada.id]: { reply: "Three rivals, priced and compared." },
      [ben.id]: { steps: [{ arguments: { bot_ids: [cy.id], message: "Check the pricing page copy", thread: "new" } }], reply: "Asked Cy", resumeReply: "Cy checked the copy: two fixes." },
      [cy.id]: { reply: "Two fixes on the pricing page." },
      [dee.id]: { gateFile: gate, timeoutMs: 120_000, reply: "Never gets here" },
    }));

    const mission = { id: "m-pricing-review", title: "Pricing review", launchedAt: Date.now() - 1_000 };
    const refused = await api("POST", `/api/bots/${ada.id}/tasks`, { title: "x", select: false, mission: { ...mission, lane: 99 } });
    expect(refused.status).toBe(400);
    const lanes: Array<{ bot: any; threadId: string }> = [];
    for (const [lane, one] of [ada, ben, dee].entries()) {
      const made = await api("POST", `/api/bots/${one.id}/tasks`, { title: `Pricing review · ${one.name}`, select: false, mission: { ...mission, lane } });
      expect(made.status).toBe(201);
      expect(made.body.task.mission).toEqual({ ...mission, lane });
      lanes.push({ bot: one, threadId: made.body.task.threadId });
    }
    const idle = (await api("GET", `/api/missions/${mission.id}`)).body;
    expect(idle).toMatchObject({ state: "idle", lanes: 3 });
    expect(idle.board.map((lane: any) => lane.state)).toEqual(["idle", "idle", "idle"]);

    for (const { bot: one, threadId } of lanes) {
      expect((await api("POST", `/api/bots/${one.id}/messages`, { threadId, text: "Review our pricing against three rivals", sendId: `send-${one.id}` })).status).toBe(202);
    }
    const lane = async (botId: string) => (await api("GET", `/api/missions/${mission.id}`)).body.board.find((row: any) => row.botId === botId);
    await expect.poll(async () => (await lane(ada.id))?.state, { timeout: 30_000 }).toBe("done");
    await expect.poll(async () => (await lane(ben.id))?.state, { timeout: 30_000 }).toBe("done");
    await expect.poll(async () => (await lane(dee.id))?.state, { timeout: 30_000 }).toBe("working");

    const running = (await api("GET", `/api/missions/${mission.id}`)).body;
    expect(running).toMatchObject({ id: mission.id, title: "Pricing review", state: "running", counts: { done: 2, working: 1 } });
    expect(running.board.find((row: any) => row.botId === ada.id)).toMatchObject({ reply: "Three rivals, priced and compared.", teammates: 0 });
    expect(running.board.find((row: any) => row.botId === ben.id)).toMatchObject({ reply: "Cy checked the copy: two fixes.", teammates: 1, teammatesOpen: 0 });
    expect(running.marks).toContainEqual(expect.objectContaining({ kind: "handoff", botName: "Cy", laneThreadId: lanes[1]!.threadId }));
    expect(running.spans.some((span: any) => span.botName === "Cy" && span.depth === 1 && span.state === "done")).toBe(true);
    expect(running.spans.filter((span: any) => span.laneThreadId === lanes[2]!.threadId).at(-1)).toMatchObject({ state: "working" });

    const listed = (await api("GET", "/api/missions")).body.missions;
    expect(listed).toContainEqual(expect.objectContaining({ id: mission.id, state: "running", lanes: 3 }));

    const held = api("GET", `/api/missions/${mission.id}?wait=20000&version=${running.version}`);
    expect((await api("POST", `/api/bots/${dee.id}/interrupt`, { threadId: lanes[2]!.threadId })).status).toBe(200);
    const after = (await held).body;
    expect(after.version).not.toBe(running.version);
    await expect.poll(async () => (await lane(dee.id))?.state, { timeout: 30_000 }).toBe("stopped");
    await expect.poll(async () => (await api("GET", `/api/missions/${mission.id}`)).body.state, { timeout: 10_000 }).toBe("partly-done");
    writeFileSync(gate, "open");

    expect((await api("GET", "/api/missions/m-nothing-here")).status).toBe(404);
    expect((await api("GET", `/api/missions/${mission.id}?wait=99999999`)).status).toBe(400);
  }, 120_000);
});
