import { Children, createElement, type ChangeEvent, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { AppState, Bot, InstanceInfo } from "@/state/store";
import type { EffortLevel } from "../../shared/wire";
import { Select } from "./Select";

// The store module touches window and localStorage at import time, so it is stubbed to render under the node
// environment.
const fixture = vi.hoisted(() => {
  vi.stubGlobal("window", {});
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
  return { instances: [] as InstanceInfo[], modelVariantSessions: {} as AppState["modelVariantSessions"], dispatch: vi.fn() };
});
vi.mock("@/state/store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/state/store")>()),
  useStore: () => ({
    state: { instances: fixture.instances, bots: [], modelVariantSessions: fixture.modelVariantSessions },
    dispatch: fixture.dispatch,
    refreshInstances: vi.fn(),
    refreshModels: vi.fn(),
  }),
}));

// The effort and variant rows, and the picker's chip; the menu has its own files.

const { EffortRow, ModelPicker, ModelVariantRow } = await import("./ModelPicker");
const { modelSelectionForPick } = await import("@/lib/model-choices");

afterAll(() => vi.unstubAllGlobals());

function engine(effortLevels?: readonly EffortLevel[]): InstanceInfo {
  return {
    instanceId: "codex",
    driverKind: "codex",
    displayName: "Codex",
    snapshot: { state: "available", version: "1.0.0" },
    models: { default: "gpt-5.6", options: [{ id: "gpt-5.6", label: "GPT-5.6" }] },
    ...(effortLevels ? { capabilities: { effortLevels } } : {}),
  };
}

function bot(effort?: EffortLevel): Bot {
  return {
    id: "atlas",
    threadId: "thread-atlas",
    name: "Atlas",
    title: "",
    description: "",
    notifications: true,
    color: "green",
    unread: false,
    modelSelection: { instanceId: "codex", model: "gpt-5.6", ...(effort ? { effort } : {}) },
    messages: [],
  };
}

function levelButtons(markup: string): Array<{ label: string; pressed: boolean }> {
  return [...markup.matchAll(/<button[^>]*aria-pressed="(true|false)"[^>]*>([^<]+)</g)].map((match) => ({
    label: match[2],
    pressed: match[1] === "true",
  }));
}

function renderEffort(instances: InstanceInfo[], effort?: EffortLevel): string {
  fixture.instances = instances;
  return renderToStaticMarkup(createElement(EffortRow, { bot: bot(effort) }));
}

describe("EffortRow", () => {
  it("uses a compact dropdown without changing scope or conflating None with Default", () => {
    fixture.instances = [engine(["none", "low", "high"])];
    const row = EffortRow({ bot: bot("high"), threadId: "independent-thread", updateBotDefault: true, compact: true })!;
    const select = Children.toArray(row.props.children).at(-1) as ReactElement<{ value: string; onChange: (event: ChangeEvent<HTMLSelectElement>) => void }>;
    expect(select.type).toBe(Select);
    expect(select.props.value).toBe("high");
    for (const value of ["none", ""]) {
      select.props.onChange({ target: { value } } as ChangeEvent<HTMLSelectElement>);
      expect(fixture.dispatch).toHaveBeenLastCalledWith({ type: "setModel", botId: "atlas", threadId: "independent-thread", updateBotDefault: true,
        selection: { instanceId: "codex", model: "gpt-5.6", effort: value || undefined } });
    }
    const markup = renderToStaticMarkup(createElement(EffortRow, { bot: bot(), compact: true }));
    expect(markup).toContain('aria-label="Reasoning effort"');
    expect(markup).not.toContain("<button");
    expect([...markup.matchAll(/<option[^>]*>([^<]+)</g)].map((match) => match[1])).toEqual(["Default", "None", "Low", "High"]);
  });
  it("can apply effort to the pinned thread and bot default together", () => {
    fixture.instances = [engine(["high"])];
    const row = EffortRow({ bot: bot(), threadId: "thread-atlas", updateBotDefault: true })!;
    const levels = Children.toArray(row.props.children).at(-1) as ReactElement<{ children: ReactNode }>;
    const high = Children.toArray(levels.props.children)[1] as ReactElement<{ onClick: () => void }>;
    high.props.onClick();
    expect(fixture.dispatch).toHaveBeenLastCalledWith({ type: "setModel", botId: "atlas", threadId: "thread-atlas", updateBotDefault: true, selection: { instanceId: "codex", model: "gpt-5.6", effort: "high" } });
  });
  it("pins thread effort changes without changing profile defaults", () => {
    fixture.instances = [engine(["high"])];
    const row = EffortRow({ bot: bot(), threadId: "independent-thread" })!;
    const levels = Children.toArray(row.props.children).at(-1) as ReactElement<{ children: ReactNode }>;
    const high = Children.toArray(levels.props.children)[1] as ReactElement<{ onClick: () => void }>;
    high.props.onClick();
    expect(fixture.dispatch).toHaveBeenLastCalledWith({ type: "setModel", botId: "atlas", threadId: "independent-thread", selection: { instanceId: "codex", model: "gpt-5.6", effort: "high" } });
  });
  it("renders nothing for an engine that declares no effort levels", () => {
    expect(renderEffort([engine()])).toBe("");
    expect(renderEffort([engine([])])).toBe("");
    expect(renderEffort([])).toBe("");
  });

  it("offers only the levels the selected engine accepts, plus Default", () => {
    const markup = renderEffort([engine(["low", "medium", "high"])]);

    expect(levelButtons(markup).map((button) => button.label)).toEqual(["Default", "Low", "Medium", "High"]);
    expect(markup).not.toContain(">X-high<");
    expect(markup).not.toContain(">Max<");
  });

  it("keeps Default and None apart: Default sends no level, None sends one", () => {
    const markup = renderEffort([engine(["none", "low"])]);

    expect(levelButtons(markup).map((button) => button.label)).toEqual(["Default", "None", "Low"]);
  });

  it("marks the active level, and Default when the bot carries no level", () => {
    const pressed = (markup: string) => levelButtons(markup).find((button) => button.pressed)?.label;

    expect(pressed(renderEffort([engine(["low", "high"])], "high"))).toBe("High");
    expect(pressed(renderEffort([engine(["low", "high"])]))).toBe("Default");
  });

  it("renames xhigh, the one level that does not capitalize cleanly", () => {
    expect(renderEffort([engine(["xhigh"])])).toContain(">X-high<");
  });
});


describe("OpenCode model variants", () => {
  const variants = [
    { id: "none", label: "none" }, { id: "minimal", label: "Minimal" },
    { id: "default", label: "Default" }, { id: "deep/custom", label: "Deep custom" },
  ];
  const opencode = (): InstanceInfo => ({ ...engine(), instanceId: "opencode", driverKind: "opencodeGo",
    capabilities: { modelVariants: true }, models: { default: "provider/model", options: [{ id: "provider/model", label: "Model", variants }] } });
  const selected = (variant?: string): Bot => ({ ...bot(), modelSelection: { instanceId: "opencode", model: "provider/model", ...(variant !== undefined ? { variant } : {}) } });
  beforeEach(() => { fixture.instances = [opencode()]; fixture.modelVariantSessions = {}; fixture.dispatch.mockClear(); });
  const render = (variant?: string) => renderToStaticMarkup(createElement(ModelVariantRow, { bot: selected(variant), threadId: "thread-atlas" }));

  it("keeps opaque variant ids and omission distinct in the compact dropdown", () => {
    const row = ModelVariantRow({ bot: selected("default"), threadId: "thread-atlas", compact: true })!;
    const label = Children.toArray(row.props.children)[0] as ReactElement<{ children: ReactNode }>;
    const select = Children.toArray(label.props.children).at(-1) as ReactElement<{ value: string; onChange: (event: ChangeEvent<HTMLSelectElement>) => void }>;
    expect(select.props.value).toBe("2");
    for (const [value, variant] of [["3", "deep/custom"], ["unset", undefined]]) {
      select.props.onChange({ target: { value } } as ChangeEvent<HTMLSelectElement>);
      expect(fixture.dispatch).toHaveBeenLastCalledWith({ type: "setModel", botId: "atlas", threadId: "thread-atlas",
        selection: { instanceId: "opencode", model: "provider/model", ...(variant !== undefined ? { variant } : {}) } });
    }
    const markup = renderToStaticMarkup(createElement(ModelVariantRow, { bot: { ...selected("removed"), busy: true }, compact: true }));
    expect(markup).toContain('disabled=""');
    expect(markup).toContain("removed (unverified)");
    expect(markup).toContain("Use session setting");
  });

  it("offers exact advertised ids without assuming that omission means none or default", () => {
    const markup = render();
    expect(levelButtons(markup)).toEqual([
      { label: "none", pressed: false }, { label: "Minimal", pressed: false },
      { label: "OpenCode default", pressed: false }, { label: "Deep custom", pressed: false },
    ]);
    expect(markup).toContain("No variant selected.");
    expect(fixture.dispatch).not.toHaveBeenCalled();
    expect(levelButtons(render("none")).find((button) => button.pressed)?.label).toBe("none");
  });

  it.each(variants)("persists $id only to the pinned conversation and clears legacy effort", (option) => {
    const configured = selected();
    configured.modelSelection.effort = "high";
    const row = ModelVariantRow({ bot: configured, threadId: "independent-thread" })!;
    const group = Children.toArray(row.props.children).at(-1) as ReactElement<{ children: ReactNode }>;
    const button = Children.toArray(group.props.children)[variants.findIndex((candidate) => candidate.id === option.id)] as ReactElement<{ onClick: () => void }>;
    button.props.onClick();
    expect(fixture.dispatch).toHaveBeenLastCalledWith({ type: "setModel", botId: "atlas", threadId: "independent-thread",
      selection: { instanceId: "opencode", model: "provider/model", variant: option.id } });
  });

  it.each(["none", "default", "minimal", "removed"])("can clear %s to omission without asking for a default or none", (variant) => {
    const row = ModelVariantRow({ bot: selected(variant), threadId: "thread-atlas" })!;
    const clear = Children.toArray(row.props.children).find((child) =>
      typeof child === "object" && "type" in child && child.type === "button") as ReactElement<{ onClick: () => void; title: string }>;
    expect(clear.props.title).toContain("keeps its session or configured setting");
    clear.props.onClick();
    expect(fixture.dispatch).toHaveBeenLastCalledWith({ type: "setModel", botId: "atlas", threadId: "thread-atlas",
      selection: { instanceId: "opencode", model: "provider/model" } });
  });

  it("uses matching session choices, including an empty list, without changing the instance catalog", () => {
    fixture.modelVariantSessions["thread-atlas"] = { instanceId: "opencode", model: "provider/model", turnId: "turn", startedAt: "2026-09-15T00:00:00Z", acceptingUpdates: false,
      variants: { options: [{ id: "minimal", label: "Session minimal" }], currentValue: "minimal" } };
    expect(levelButtons(render()).map((button) => button.label)).toEqual(["Session minimal"]);
    expect(render()).toContain("No variant selected. Session: Session minimal.");
    expect(levelButtons(render()).some((button) => button.pressed)).toBe(false);
    expect(fixture.instances[0].models.options[0].variants).toEqual(variants);
    fixture.modelVariantSessions["thread-atlas"].variants = { options: [] };
    expect(render()).toBe("");
    expect(render("none")).toContain("is unavailable");
    expect(render("none")).not.toContain('aria-label="Reasoning variant"');
  });

  it("ignores another conversation, account, or model's session choices and preserves unavailable saved ids", () => {
    const session = { instanceId: "opencode", model: "provider/model", turnId: "turn", startedAt: "2026-09-15T00:00:00Z", acceptingUpdates: false, variants: { options: [] } };
    fixture.modelVariantSessions["other-thread"] = session;
    expect(levelButtons(render())).toHaveLength(4);
    fixture.modelVariantSessions["thread-atlas"] = { ...session, instanceId: "other-account" };
    expect(levelButtons(render())).toHaveLength(4);
    fixture.modelVariantSessions["thread-atlas"] = { ...session, model: "other-model" };
    expect(levelButtons(render())).toHaveLength(4);
    expect(render("removed")).toContain("Saved variant “removed” has not been checked in this session.");
    expect(fixture.dispatch).not.toHaveBeenCalled();
  });

  it("does not invent default or expose a control on a model without variants", () => {
    fixture.instances[0].models.options[0].variants = [{ id: "minimal", label: "Minimal" }];
    expect(levelButtons(render()).map((button) => button.label)).toEqual(["Minimal"]);
    fixture.instances[0].models.options[0].variants = [];
    expect(render()).toBe("");
    fixture.instances[0].capabilities = {};
    expect(render("none")).toBe("");
  });

  it("does not declare a saved default invalid on reload before ACP announces its choices", () => {
    fixture.instances[0].models.options[0].variants = [{ id: "minimal", label: "Minimal" }];
    const markup = render("default");
    expect(markup).toContain("has not been checked in this session");
    expect(markup).not.toContain("is unavailable");
    expect(levelButtons(markup).map((button) => button.label)).toEqual(["Minimal"]);
    expect(fixture.dispatch).not.toHaveBeenCalled();
  });

  it("keeps the saved choice after reload while allowing profile choices to update the profile", () => {
    expect(levelButtons(render("minimal")).find((button) => button.pressed)?.label).toBe("Minimal");
    const row = ModelVariantRow({ bot: selected(), updateBotDefault: true })!;
    const group = Children.toArray(row.props.children).at(-1) as ReactElement<{ children: ReactNode }>;
    (Children.toArray(group.props.children)[1] as ReactElement<{ onClick: () => void }>).props.onClick();
    expect(fixture.dispatch).toHaveBeenLastCalledWith({ type: "setModel", botId: "atlas", threadId: undefined, updateBotDefault: true,
      selection: { instanceId: "opencode", model: "provider/model", variant: "minimal" } });
  });

  it("drops an opaque variant when switching models/accounts but keeps it when reselecting the same model", () => {
    const selection = selected("minimal").modelSelection;
    expect(modelSelectionForPick(selection, opencode(), "provider/other")).toEqual({ instanceId: "opencode", model: "provider/other" });
    expect(modelSelectionForPick(selection, { ...opencode(), instanceId: "other" }, "provider/model")).toEqual({ instanceId: "other", model: "provider/model" });
    expect(modelSelectionForPick(selection, opencode(), "provider/model")).toEqual(selection);
    expect(modelSelectionForPick({ ...selection, effort: "high" }, opencode(), "provider/other")).not.toHaveProperty("effort");
    expect(modelSelectionForPick(bot("high").modelSelection, engine(["high"]), "other")).toEqual({ instanceId: "codex", model: "other", effort: "high" });
  });
});

describe("ModelPicker trigger", () => {


  /** React HTML-escapes the apostrophe and may encode the newline numerically; both are undone here. */
  const tooltipLines = (markup: string): string[] => {
    const encoded = markup.match(/<button[^>]*\stitle="([^"]*)"/s)?.[1];
    if (encoded === undefined) return [];
    const amp = String.fromCharCode(38);
    const newline = String.fromCharCode(10);
    return encoded
      .replaceAll(amp + "#x27;", "'")
      .replaceAll(amp + "#10;", newline)
      .split(newline);
  };

  it("stays open to picks while the bot works, saying a pick is for the next message", () => {
    fixture.instances = [engine()];
    const markup = renderToStaticMarkup(createElement(ModelPicker, { bot: { ...bot(), busy: true }, threadId: "independent-thread" }));
    expect(tooltipLines(markup)).toEqual(["Codex · GPT-5.6", "A model you pick now is used from the next message"]);
    expect(markup).not.toMatch(/data-tour="model"[^>]* disabled=""/);
  });

});

describe("the model pill names what answers", () => {
  const sol = { id: "gpt-5.6-sol", label: "GPT-5.6 Sol" };
  const codex = (snapshot: InstanceInfo["snapshot"]): InstanceInfo => ({
    instanceId: "codex", driverKind: "codex", displayName: "Codex", snapshot, models: { default: sol.id, options: [sol] },
  });
  const free: InstanceInfo = {
    instanceId: "opencode", driverKind: "opencodeGo", displayName: "OpenCode", access: "subscription",
    snapshot: { state: "available", authenticated: true, freeFallback: true },
    models: { default: "opencode/beam-free", options: [{ id: "opencode/beam-free", label: "Zen · Beam Free" }] },
  };
  const pill = (instances: InstanceInfo[], modelSelection: Bot["modelSelection"]) => {
    fixture.instances = instances;
    const markup = renderToStaticMarkup(createElement(ModelPicker, { bot: { ...bot(), modelSelection }, threadId: "thread-atlas" }));
    return /<span class="min-w-0 max-w-\[160px\] truncate">([^<]*)<\/span>/.exec(markup)?.[1];
  };
  const onSol = { instanceId: "codex", model: sol.id };

  it("says Free model when the free backup answers", () => {
    expect(pill([free], { instanceId: "opencode", model: "opencode/beam-free" })).toBe("Free model");
  });

  it("says why a ChatGPT model can't answer instead of its name", () => {
    expect(pill([free, codex({ state: "available", authenticated: false })], onSol)).toBe("Sign-in required");
    expect(pill([free, codex({ state: "unavailable", reason: "codex CLI not found" })], onSol)).toBe("Setup required");
    expect(pill([free], onSol)).toBe("Unavailable");
  });

  it("names the model of a connected AI that can answer", () => {
    expect(pill([free, codex({ state: "available", authenticated: true })], onSol)).toBe("GPT-5.6 Sol");
  });
});
