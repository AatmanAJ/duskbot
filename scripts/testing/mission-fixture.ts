import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: { ui: { type: "string" }, release: { type: "boolean" } } });
if (!values.ui) throw new Error("usage: mission-fixture.ts --ui HANDLE [--release]");
const handle = JSON.parse(readFileSync(values.ui, "utf8")) as { url: string; home: string };
const dataDir = handle.home;
const gates = join(dataDir, "mission-gates");
mkdirSync(gates, { recursive: true });
const gate = (name: string) => join(gates, name);

if (values.release) {
  for (const name of ["atlas", "okra"]) writeFileSync(gate(name), "open");
  console.log(JSON.stringify({ ok: true, released: ["atlas", "okra"] }));
  process.exit(0);
}

async function api(method: string, path: string, body?: unknown): Promise<any> {
  const response = await fetch(`${handle.url}${path}`, {
    method, headers: { "content-type": "application/json", origin: handle.url }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${text}`);
  return text ? JSON.parse(text) : {};
}

const COLORS = ["coral", "teal", "purple", "yellow", "cyan", "pink"];
const names = ["Atlas", "Ferro", "Lumen", "Pike", "Sable", "Okra"] as const;
const bots: Record<(typeof names)[number], { id: string }> = {} as never;
for (const [index, name] of names.entries()) bots[name] = (await api("POST", "/api/bots", { name, color: COLORS[index] })).bot;

const LAUNCH = "spring launch";
const TEARDOWN = "competitor teardown";
const HOUR = 3_600_000;
writeFileSync(join(dataDir, "room-plan.json"), JSON.stringify({
  [bots.Atlas.id]: { byPrompt: [
    { promptIncludes: LAUNCH, plan: { gateFile: gate("atlas"), timeoutMs: HOUR, progress: "Reading last spring's launch notes",
      reply: "Timeline drafted: soft launch on the 14th, press on the 16th, a two-week promo window." } },
  ] },
  [bots.Ferro.id]: { byPrompt: [
    { promptIncludes: LAUNCH, plan: {
      steps: [{ arguments: { bot_ids: [bots.Okra.id], message: "Price the three glaze bundles against the two closest rivals", thread: "new" } }],
      reply: "Asked Okra for bundle pricing.", resumeReply: "Bundles priced: the three-glaze set at $64 undercuts both rivals by about 8%." } },
    { promptIncludes: TEARDOWN, plan: { reply: "Fern & Kiln ships free over $50; we charge for every order. That is the gap to close." } },
  ] },
  [bots.Okra.id]: { byPrompt: [
    { promptIncludes: "glaze bundles", plan: { gateFile: gate("okra"), timeoutMs: HOUR, reply: "Three-glaze set: $64. Rivals sit at $69 and $71." } },
  ] },
  [bots.Lumen.id]: { byPrompt: [
    { promptIncludes: LAUNCH, plan: { reply: [
      "**Launch checklist**", "", "1. Product photos for the six new glazes", "2. Shop page copy and alt text",
      "3. Email to the 1,240 subscribers", "4. Instagram posts for three days", "5. Restock the studio kiln shelf",
    ].join("\n") } },
    { promptIncludes: TEARDOWN, plan: { reply: "Clay Theory posts three times a day and answers every comment within the hour." } },
  ] },
  [bots.Pike.id]: { byPrompt: [
    { promptIncludes: LAUNCH, plan: { reply: "Drafted two subject lines for the launch email.\n\nNEEDS INPUT: Should the email go out Tuesday morning or Thursday evening?\nDefault: Tuesday morning" } },
    { promptIncludes: TEARDOWN, plan: { reply: "Their reviews mention packaging four times as often as ours do." } },
  ] },
  [bots.Sable.id]: { byPrompt: [
    { promptIncludes: LAUNCH, plan: { failWith: "The supplier price sheet answered 403 Forbidden" } },
  ] },
}));

async function launch(title: string, brief: string, lanes: Array<keyof typeof bots>, notes: Record<string, string> = {}): Promise<string> {
  const id = `m-${title.toLowerCase().replace(/[^a-z]+/g, "-")}`;
  const launchedAt = Date.now() - 1_000;
  for (const [lane, name] of lanes.entries()) {
    const text = notes[name] ? `${brief}\n\n${notes[name]}` : brief;
    const { task } = await api("POST", `/api/bots/${bots[name].id}/tasks`, { title, select: false, mission: { id, title, lane, launchedAt, brief: text } });
    await api("POST", `/api/bots/${bots[name].id}/messages`, { threadId: task.threadId, text, sendId: `${id}-${lane}` });
  }
  return id;
}

const until = async (id: string, done: (view: any) => boolean) => {
  for (let tries = 0; tries < 120; tries += 1) {
    const view = await api("GET", `/api/missions/${id}`);
    if (done(view)) return view;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`mission ${id} did not settle`);
};

const teardown = await launch("Competitor teardown", `Run a ${TEARDOWN} of the two shops closest to Juniper Lane Ceramics.`, ["Ferro", "Lumen", "Pike"]);
await until(teardown, (view) => view.state === "done");
const spring = await launch("Spring launch review", `Plan the ${LAUNCH} of the new glaze line for Juniper Lane Ceramics. Report back in a few lines.`,
  ["Atlas", "Ferro", "Lumen", "Pike", "Sable"], { Ferro: "Own the pricing: bundles and the promo discount." });
const view = await until(spring, (one) => one.board.filter((lane: any) => lane.state !== "queued" && lane.state !== "idle").length === 5
  && one.board.some((lane: any) => lane.state === "waiting"));
console.log(JSON.stringify({ ok: true, missions: [teardown, spring], lanes: view.board.map((lane: any) => [lane.botName, lane.state]) }));
