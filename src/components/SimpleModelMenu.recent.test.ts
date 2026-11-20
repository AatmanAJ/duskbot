// @vitest-environment happy-dom
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InstanceInfo, ModelSelection } from "@/state/store";
import { simpleModelMenu } from "@/lib/simple-model-menu";
import { starKey } from "@/lib/starred-models";
import { SimpleModelMenu, type SimpleModelMenuProps } from "./SimpleModelMenu";

const engine = (instanceId: string, driverKind: string, displayName: string, options: Array<{ id: string; label: string }>, extra: Partial<InstanceInfo> = {}): InstanceInfo => ({
  instanceId, driverKind, displayName, access: "subscription",
  snapshot: { state: "available", authenticated: true },
  models: { default: options[0]!.id, options }, ...extra,
});
const claude = engine("claude", "claudeAgent", "Claude", [{ id: "sonnet-5", label: "Claude Sonnet 5" }, { id: "opus-5", label: "Claude Opus 5" }]);
const codex = engine("codex", "codex", "Codex", [{ id: "gpt-5.5", label: "GPT-5.5" }]);
const sonnet: ModelSelection = { instanceId: "claude", model: "sonnet-5" };

let root: Root;
let host: HTMLElement;
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => { flushSync(() => root.unmount()); host.remove(); });

function render(overrides: Partial<SimpleModelMenuProps> = {}, instances = [claude, codex]) {
  const menu = simpleModelMenu({ instances, listed: instances, selection: sonnet, bot: { name: "Pepper", selection: sonnet },
    query: "", expanded: new Set(), probing: new Set(), loading: false, recent: [starKey("codex", "gpt-5.5")] });
  const props: SimpleModelMenuProps = {
    menu, query: "", bot: { name: "Pepper", color: "blue" }, botModel: { label: "Sonnet 5", title: "" }, idPrefix: "m",
    onQuery: vi.fn(), onPick: vi.fn(), onPickCurrent: vi.fn(), onFollowBot: vi.fn(), onToggle: vi.fn(), onSetUp: vi.fn(), onCheckAgain: vi.fn(),
    ...overrides,
  };
  flushSync(() => root.render(createElement(SimpleModelMenu, props)));
  return props;
}

describe("the model list", () => {
  it("puts recent picks under the current model, each on one line with its provider's mark", () => {
    const props = render();
    const recent = host.querySelector("[data-picker-recent]")!;
    expect(recent.textContent).toContain("Recent");
    const row = recent.querySelector<HTMLButtonElement>("[data-menu-row]")!;
    expect(row.getAttribute("aria-label")).toBe("GPT-5.5 · OpenAI");
    expect(row.querySelector("[data-simple-route]")).toBeNull();
    flushSync(() => row.click());
    expect(props.onPick).toHaveBeenCalledWith(codex, "gpt-5.5", undefined);
  });

  it("offers Disconnect on each provider's heading, by name, only where the person may", () => {
    const onDisconnect = vi.fn();
    render({ onDisconnect });
    const button = host.querySelector<HTMLButtonElement>('[data-picker-disconnect="codex"]')!;
    expect(button.getAttribute("aria-label")).toBe("Disconnect OpenAI");
    expect(button.hasAttribute("data-menu-row")).toBe(false);
    flushSync(() => button.click());
    expect(onDisconnect).toHaveBeenCalledWith(codex, "OpenAI");
    render();
    expect(host.querySelector("[data-picker-disconnect]")).toBeNull();
  });
});
