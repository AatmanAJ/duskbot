import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Bot } from "@/state/store";
import { PeerExchangeLine } from "./PeerExchangeLine";

const bots = [{ id: "ghosty", name: "Ghosty", color: "silver" }, { id: "amy", name: "Amy", color: "pink" }] as Bot[];
const render = (summary: Parameters<typeof PeerExchangeLine>[0]["summary"], expanded = false) =>
  renderToStaticMarkup(createElement(PeerExchangeLine, { summary, bots, expanded, onToggle: () => {} }));

describe("PeerExchangeLine", () => {
  it("says grok's words, with the bot as a chip that opens the messages", () => {
    const html = render({ kind: "thread", count: 3, peers: [{ id: "ghosty", name: "" }] });
    expect(html).toContain(">3 messages with<");
    expect(html).toContain(">Ghosty<");
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-label="Show messages with Ghosty"');
    expect(render({ kind: "single", direction: "outbound", peer: { id: "ghosty", name: "Ghosty" } }, true)).toMatch(/>Messaged<.*aria-expanded="true"/);
    expect(render({ kind: "single", direction: "inbound", peer: { id: "amy", name: "Amy" } })).toContain(">Message from<");
  });

  it("reads a teammate's question and the answer inline in each bot's one chat", () => {
    const asked = render({ kind: "single", direction: "inbound", peer: { id: "ghosty", name: "Ghosty" }, body: "@Amy  What is\nthe plan?" });
    expect(asked).toMatch(/>Message from<.*>Ghosty<.*data-peer-said.*>What is the plan\?</);
    expect(render({ kind: "single", direction: "outbound", as: "reply", peer: { id: "ghosty", name: "Ghosty" } })).toMatch(/data-peer-exchange="reply".*>Responded to<.*>Ghosty</);
    expect(render({ kind: "single", direction: "outbound", as: "ask", peer: { id: "amy", name: "Amy" } })).toMatch(/>Asked<.*>Amy</);
    expect(render({ kind: "single", direction: "inbound", as: "answer", peer: { id: "amy", name: "Amy" } })).toMatch(/>Amy<.*>replied</);
  });

  it("names two bots with and, and counts three or more", () => {
    expect(render({ kind: "fanout", peers: [{ id: "ghosty", name: "Ghosty" }, { id: "amy", name: "Amy" }] })).toMatch(/>Ghosty<.*>and<.*>Amy</);
    expect(render({ kind: "fanout", peers: [{ id: "ghosty", name: "Ghosty" }, { id: "amy", name: "Amy" }, { name: "Nova" }] })).toContain(">3 bots<");
  });
});
