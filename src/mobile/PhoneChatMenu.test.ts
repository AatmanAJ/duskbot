import { describe, expect, it, vi } from "vitest";
import type { SidebarMenuItem } from "@/components/SidebarPopoverMenu";
import { phoneChatItems } from "./PhoneChatMenu";

const item = (key: string, label: string, rest: Partial<SidebarMenuItem> = {}): SidebarMenuItem => ({ key, label, onSelect() {}, ...rest });
const desktop = [
  item("profile", "Open bot profile"),
  item("find", "Find in conversation", { trailing: "Ctrl F" }),
  item("model", "Model", { value: "Claude Sonnet 5" }),
  item("computer", "Bot's screen"),
  item("copy", "Copy as Markdown", { heading: "Share", separatorBefore: true }),
  item("download", "Download as .md"),
  item("usage", "Usage", { separatorBefore: true }),
];

describe("the chat menu on a phone", () => {
  it("keeps the chat's own actions in phone words, with no shortcut, download or what the header already holds", () => {
    const items = phoneChatItems(desktop, null);
    expect(items.map((item) => item.key)).toEqual(["find", "model", "copy"]);
    expect(items.map((item) => item.label)).toEqual(["Find in chat", "Model", "Copy chat"]);
    expect(items.find((item) => item.key === "find")!.trailing).toBeUndefined();
    expect(items.some((item) => item.heading)).toBe(false);
    expect(JSON.stringify(items)).not.toMatch(/Ctrl|\.md|agent/);
  });

  it("shares the chat through the phone's share sheet where it has one", () => {
    const share = vi.fn();
    const items = phoneChatItems(desktop, share);
    expect(items.at(-1)).toMatchObject({ key: "share", label: "Share chat" });
    items.at(-1)!.onSelect();
    expect(share).toHaveBeenCalledOnce();
  });
});
