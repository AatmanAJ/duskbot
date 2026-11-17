import { describe, expect, it } from "vitest";
import type { AppEntry } from "@/components/connect-apps/catalog";
import type { NotificationLogEntry } from "../../../shared/notification";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AppFace, connectedApps } from "./ConnectorsSheet";
import { stackByOwner } from "./NotificationsSheet";
import { searchSnippetText } from "./SearchSheet";
import { readableWorkspace, settingsIdentity } from "./SettingsSheet";
import { vaultView } from "./VaultSheet";
import { recedeStyle } from "../Sheet";

const app = (id: string, categories: AppEntry["categories"], kind: AppEntry["kind"] = "composio"): AppEntry => ({ id, kind, label: id, description: "", categories, icon: {} });

describe("connected apps", () => {
  it("lists only what is connected, each app once, nothing to add", () => {
    const entries = [app("gmail", ["communication"]), app("slack", ["communication"]), app("zoho", ["productivity"]), app("misc", [])];
    expect(connectedApps(entries, new Set(["zoho", "gmail"])).map((entry) => entry.id)).toEqual(["gmail", "zoho"]);
    expect(connectedApps(entries, new Set())).toEqual([]);
  });
});

describe("settings header", () => {
  it("never shows a host and port, a URL or an IP as the subtitle", () => {
    for (const value of ["127.0.0.1:5331", "localhost", "192.168.1.4", "http://studio.local:8799", "[::1]:8799", "studio.local:8799"]) {
      expect(readableWorkspace(value)).toBeNull();
    }
    expect(readableWorkspace("Studio Mac")).toBe("Studio Mac");
  });

  it("prefers the account email, then the computer's name, then a plain phrase", () => {
    expect(settingsIdentity({ name: "Sam", email: "sam@example.com", workspace: "127.0.0.1:5331" })).toEqual({ title: "Sam", subtitle: "sam@example.com" });
    expect(settingsIdentity({ email: null, workspace: "Studio Mac" }).subtitle).toBe("Studio Mac");
    const plain = settingsIdentity({ email: null, workspace: "127.0.0.1:5331" });
    expect(plain.subtitle).not.toMatch(/\d+\.\d+|:\d+/);
    expect(settingsIdentity({ email: "sam@example.com" }).title).toBe("sam");
  });
});

describe("vault loading", () => {
  it("shows the skeleton only before the first answer, so a reload never jumps", () => {
    expect(vaultView({ loaded: false, loading: true, error: false, count: 0 })).toBe("skeleton");
    expect(vaultView({ loaded: true, loading: true, error: false, count: 3 })).toBe("list");
    expect(vaultView({ loaded: true, loading: false, error: false, count: 0 })).toBe("empty");
    expect(vaultView({ loaded: false, loading: false, error: true, count: 0 })).toBe("error");
  });
});

describe("notifications", () => {
  const note = (id: string, botId: string, at: number, read = true): NotificationLogEntry => ({ id, botId, threadId: `t-${botId}`, title: `${botId} finished`, body: "", at, read } as NotificationLogEntry);

  it("stacks a bot's notes into one row, newest on top, unread if any is", () => {
    const stacks = stackByOwner([note("a", "tally", 1), note("b", "tally", 3, false), note("c", "rivet", 2)]);
    expect(stacks.map((stack) => [stack.latest.id, stack.entries.length, stack.unread])).toEqual([["b", 2, true], ["c", 1, false]]);
  });
});

describe("search snippets", () => {
  it("drops markdown marks, including unbalanced ones", () => {
    expect(searchSnippetText("the **launch** note**")).toBe("the launch note");
  });
});

describe("page behind a sheet", () => {
  it("steps back as the sheet rises and is untouched when closed", () => {
    expect(recedeStyle(0)).toBeNull();
    expect(recedeStyle(1)?.transform).toContain("scale(0.9300)");
    expect(recedeStyle(1)?.borderRadius).toBe("14.0px");
  });
});

describe("connected apps tile", () => {
  const face = (icon: AppEntry["icon"]) => renderToStaticMarkup(createElement(AppFace, { entry: { label: "GitHub", icon } }));

  it("draws only the logo when the app has one, never its initial under it", () => {
    const html = face({ image: "data:image/svg+xml,logo", padded: true });
    expect(html).toContain("<img");
    expect(html).not.toMatch(/>G</);
  });

  it("draws the initial only when there is no logo", () => {
    const html = face({});
    expect(html).not.toContain("<img");
    expect(html.match(/>G</g)).toHaveLength(1);
  });
});
