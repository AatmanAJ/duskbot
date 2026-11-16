import { Children, createElement, isValidElement, type EffectCallback, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ effects: [] as EffectCallback[], dispatch: vi.fn(), api: vi.fn(), create: vi.fn(), setDraft: vi.fn(), ready: false, hook: 0, admin: false,
  profile: {} as Record<string, unknown>, track: vi.fn(), advanced: true, appSettingsOpen: false, openBot: vi.fn(), close: vi.fn() }));
vi.mock("@/state/thread-navigation", async importOriginal => ({
  ...await importOriginal<typeof import("@/state/thread-navigation")>(), openBot: fixture.openBot,
}));
vi.mock("@/lib/analytics", () => ({ track: fixture.track }));
vi.mock("@/lib/use-owner-or-admin", () => ({ useOwnerOrAdmin: () => fixture.admin }));
vi.mock("./DesktopCapabilities", () => ({ useDesktopCapabilities: () => ({ capabilities: {} }) }));
vi.mock("react", async importOriginal => {
  const react = await importOriginal<typeof import("react")>();
  return { ...react, useEffect: (effect: EffectCallback) => { fixture.effects.push(effect); }, useState: (initial: unknown) => {
    const state = react.useState(initial);
    const index = fixture.hook++;
    if (fixture.ready && index === 1) {
      const draft = state[0] as { bot: { name: string }; patch: (patch: { name: string }) => void };
      if (draft.bot.name !== "Fixture") draft.patch({ name: "Fixture", ...fixture.profile });
    }
    if (index === 1) return [state[0], fixture.setDraft];
    return fixture.ready && index === 3 ? [true, state[1]] : state;
  } };
});
vi.mock("@/lib/create-configured-bot", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/create-configured-bot")>(), createConfiguredBot: fixture.create,
}));
vi.mock("@/state/store", async (importOriginal) => (await import("@/testing/store-mock")).withStoreHooks(await (async importOriginal => {
  const store = await importOriginal<typeof import("@/state/store")>();
  return { ...store, api: fixture.api, BotEditorStore: () => null, useStore: () => ({ state: { ...store.initialState, appSettingsOpen: fixture.appSettingsOpen }, dispatch: fixture.dispatch }) };
})(importOriginal)));
import { BotDefaultsDialog } from "./NewBotDialog";
import { Select } from "./Select";
import { BOT_ROLES } from "@/lib/bot-roles";

type Node = ReactElement<{ children?: ReactNode; role?: string; "aria-label"?: string; onClick?: () => void; disabled?: boolean }>;
function nodes(value: ReactNode): Node[] {
  if (!isValidElement(value)) return [];
  const node = value as Node;
  return [node, ...Children.toArray(node.props.children).flatMap(nodes)];
}
// One component's own output, without rendering the components inside it.
function output(element: Node): Node[] {
  let tree: ReactNode = null;
  function Capture() { tree = (element.type as (props: unknown) => ReactNode)(element.props); return null; }
  renderToStaticMarkup(createElement(Capture));
  return nodes(tree);
}
const named = (name: string) => (node: Node) => typeof node.type === "function" && node.type.name === name;
function chooseStartingRole(dialog: Node[], value: string) {
  const role = output(dialog.find(named("DraftSection"))!).find(named("StartingRole"))!;
  const select = output(role).find(node => node.type === Select)!;
  (select.props as unknown as { onChange: (event: { target: { value: string } }) => void }).onChange({ target: { value } });
}
function render() {
  let tree!: ReturnType<typeof BotDefaultsDialog>;
  function Capture() { fixture.hook = 0; tree = BotDefaultsDialog({ onClose: fixture.close }); return tree; }
  const html = renderToStaticMarkup(createElement(Capture));
  return { html, nodes: nodes(tree) };
}
beforeEach(() => {
  fixture.advanced = true;
  fixture.effects = []; fixture.dispatch.mockReset(); fixture.api.mockReset();
  fixture.ready = false; fixture.admin = false; fixture.create.mockReset(); fixture.setDraft.mockReset(); fixture.profile = {};
  fixture.track.mockReset();
  fixture.appSettingsOpen = false;
  fixture.openBot.mockReset();
  fixture.close.mockReset();
  fixture.api.mockReturnValue(new Promise(() => {}));
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("new bot defaults dialog", () => {
  it.each([undefined, null, { instanceId: "", model: "" }])("fills an unselected saved default from the available model (%j)", async selection => {
    const available = { instanceId: "openrouter", model: "fixture-model" };
    fixture.api.mockResolvedValue({ defaults: { profile: { modelSelection: selection }, memory: {}, skills: [], routines: [] }, modelSelection: available, suggestedName: "Fixture" });
    render();
    fixture.effects[0]();
    await vi.waitFor(() => expect(fixture.setDraft).toHaveBeenCalledOnce());
    expect(fixture.setDraft.mock.calls[0]![0].bot.modelSelection).toEqual(available);
  });

  it.each([
    { instanceId: "claude", model: "chosen-model" },
    { instanceId: "claude", model: "" },
    { instanceId: "", model: "chosen-model" },
  ])("preserves an intentional saved model choice (%j)", async selection => {
    fixture.api.mockResolvedValue({ defaults: { profile: { modelSelection: selection }, memory: {}, skills: [], routines: [] }, modelSelection: { instanceId: "openrouter", model: "fixture-model" }, suggestedName: "Fixture" });
    render();
    fixture.effects[0]();
    await vi.waitFor(() => expect(fixture.setDraft).toHaveBeenCalledOnce());
    expect(fixture.setDraft.mock.calls[0]![0].bot.modelSelection).toEqual(selection);
  });

  it("keeps a saved default without a name nameless, so each new bot still gets its own", async () => {
    fixture.api.mockResolvedValue({ defaults: { profile: {}, memory: {}, skills: [], routines: [] }, modelSelection: { instanceId: "", model: "" }, suggestedName: "Fixture" });
    render();
    fixture.effects[0]();
    await vi.waitFor(() => expect(fixture.setDraft).toHaveBeenCalledOnce());
    expect(fixture.setDraft.mock.calls[0]![0].bot.name).not.toBe("Fixture");
  });

  it("can cancel a loading draft without saving anything", () => {
    const result = render();
    result.nodes.find(node => node.type === "button" && node.props["aria-label"] === "Close")!.props.onClick!();
    expect(fixture.close).toHaveBeenCalledOnce();
    expect(fixture.dispatch).not.toHaveBeenCalled();
    expect(fixture.api).not.toHaveBeenCalled();
  });

  it("saves the defaults for new bots, makes no bot and reports nothing", async () => {
    fixture.ready = true;
    fixture.api.mockResolvedValue({});
    render().nodes.filter(node => node.type === "button").at(-1)!.props.onClick!();
    await vi.waitFor(() => expect(fixture.api).toHaveBeenCalledWith("/api/config", expect.objectContaining({ method: "PATCH" })));
    await vi.waitFor(() => expect(fixture.close).toHaveBeenCalledOnce());
    expect(fixture.create).not.toHaveBeenCalled();
    expect(fixture.track).not.toHaveBeenCalled();
  });

  it("is the section editor for the defaults, never a way to create a bot", () => {
    const result = render();
    expect(result.html).toContain("Defaults for new bots");
    expect(result.html).toContain("Save defaults");
    expect(result.html).not.toContain(">Create bot<");
    expect(result.html).not.toContain("Who can see it");
  });

  it("starts from a built-in role", () => {
    vi.stubGlobal("window", {});
    fixture.ready = true;
    const dialog = render().nodes;
    chooseStartingRole(dialog, BOT_ROLES[0]!.id);
    expect((dialog.find(named("DraftSection"))!.props as unknown as { draft: { role?: string } }).draft.role).toBe(BOT_ROLES[0]!.id);
  });
});
