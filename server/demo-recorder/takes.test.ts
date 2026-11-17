import { Window } from "happy-dom";
import { afterEach, describe, expect, it } from "vitest";

import type { DemoDrain } from "./events.ts";
import {
  DEMO_LOCATE_SCRIPT, demoActExpression, demoDrainExpression, demoFindExpression, demoForgetExpression, demoRecordingScript,
  type DemoFound,
} from "./page-script.ts";

const cleanup: Array<() => unknown> = [];
afterEach(async () => { for (const step of cleanup.splice(0)) await step(); });

function page(html: string) {
  const window = new Window({ url: "https://portal.example/expenses", settings: { disableJavaScriptEvaluation: false } });
  window.document.body.innerHTML = html;
  cleanup.push(() => window.happyDOM.close());
  const types = (drain: DemoDrain) => drain.events.map((event) => event.type);
  return {
    window,
    drain: (take: string) => types(JSON.parse(window.eval(demoDrainExpression(take)) as string) as DemoDrain),
    click: (selector: string) => { window.document.querySelector(selector)!.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true })); },
  };
}

describe("what a page keeps, and for which recording", () => {
  it("keeps nothing while nobody records: a page the replayer was in has nothing to hand over", () => {
    const { window, drain, click } = page("<button>Save draft</button>");
    window.eval(DEMO_LOCATE_SCRIPT);
    click("button");
    click("button");
    expect(drain("take-a")).toEqual(["open"]);
    click("button");
    expect(drain("take-a")).toEqual(["click"]);
  });

  it("keeps nothing once the recording has ended, so the next one starts from what it sees", () => {
    const { window, drain, click } = page("<button>Save draft</button>");
    window.eval(demoRecordingScript("take-a"));
    click("button");
    expect(drain("take-a")).toEqual(["open", "click"]);
    click("button");
    expect(JSON.parse(window.eval(demoForgetExpression()) as string)).toEqual({ ok: true });
    click("button");
    expect(window.sessionStorage.length).toBe(0);
    expect(drain("take-b")).toEqual(["open"]);
  });

  it("hands a new recording nothing an earlier one left unread", () => {
    const { window, drain, click } = page("<button>Save draft</button>");
    window.eval(demoRecordingScript("take-a"));
    click("button");
    expect(drain("take-b")).toEqual(["open"]);
    click("button");
    expect(drain("take-b")).toEqual(["click"]);
  });

  it("carries what a left page saw into the next page of the same recording only", () => {
    const first = page("<button>Next</button>");
    first.window.eval(demoRecordingScript("take-a"));
    first.click("button");
    first.window.dispatchEvent(new first.window.Event("pagehide"));
    const left = first.window.sessionStorage.getItem("__dusk_demo_queue")!;
    expect(JSON.parse(left)).toMatchObject({ take: "take-a" });

    const same = page("<p>Next page</p>");
    same.window.sessionStorage.setItem("__dusk_demo_queue", left);
    same.window.eval(demoRecordingScript("take-a"));
    expect(same.drain("take-a")).toEqual(["open", "click", "open"]);

    const other = page("<p>Next page</p>");
    other.window.sessionStorage.setItem("__dusk_demo_queue", left);
    other.window.eval(demoRecordingScript("take-b"));
    expect(other.drain("take-b")).toEqual(["open"]);
    expect(other.window.sessionStorage.getItem("__dusk_demo_queue")).toBeNull();
  });

  it("refuses a recording name that is not a plain token", () => {
    const { window, drain, click } = page("<button>Save draft</button>");
    window.eval(demoRecordingScript('x"; alert(1); "'));
    click("button");
    expect(drain('x"; alert(1); "')).toEqual([]);
  });
});

describe("typing where the page will not take the keys", () => {
  it("does not report a field as ready when it could not be given the keyboard", () => {
    const { window } = page('<label>Merchant <input name="merchant" disabled></label><label>Notes <input name="notes"></label>');
    window.eval(DEMO_LOCATE_SCRIPT);
    const find = (name: string, nonce: string) => JSON.parse(window.eval(demoFindExpression({ role: "textbox", name }, { kind: "fill", nonce })) as string) as DemoFound;
    const focus = (nonce: string) => JSON.parse(window.eval(demoActExpression(nonce, { do: "focus" })) as string) as { ok: boolean; reason?: string };

    expect(find("Notes", "n1").count).toBe(1);
    expect(focus("n1")).toMatchObject({ ok: true });
    expect(find("Merchant", "n2").count).toBe(1);
    expect(focus("n2")).toEqual({ ok: false, reason: "unfocused" });
  });

  it("reads back what an editable region holds, not a value it does not have", () => {
    const { window } = page('<div contenteditable="true" role="textbox" aria-label="Message">Hello there</div>');
    window.eval(DEMO_LOCATE_SCRIPT);
    expect((JSON.parse(window.eval(demoFindExpression({ role: "textbox", name: "Message" }, { kind: "fill", nonce: "m1" })) as string) as DemoFound).count).toBe(1);
    expect(JSON.parse(window.eval(demoActExpression("m1", { do: "read" })) as string)).toMatchObject({ ok: true, value: "Hello there" });
  });
});

describe("fields named as secrets in words the browser's own rule does not list", () => {
  it.each(["API token", "Secret", "Authentication code", "Access code", "2FA code"])("never reads a field labelled %s", (label) => {
    const window = new Window({ url: "https://portal.example/settings", settings: { disableJavaScriptEvaluation: false } });
    cleanup.push(() => window.happyDOM.close());
    window.document.body.innerHTML = `<label>${label} <input name="f1"></label><label>Nickname <input name="f2"></label>`;
    window.eval(demoRecordingScript("take-a"));
    for (const [name, text] of [["f1", "tr0ub4dor-live-value"], ["f2", "Ada"]] as const) {
      const field = window.document.querySelector(`[name=${name}]`) as unknown as { value: string; dispatchEvent(event: unknown): boolean };
      field.value = text;
      field.dispatchEvent(new window.Event("input", { bubbles: true }));
    }
    const drained = window.eval(demoDrainExpression("take-a")) as string;
    expect(drained).not.toContain("tr0ub4dor-live-value");
    expect(drained).toContain("Ada");
    const typed = (JSON.parse(drained) as DemoDrain).events.filter((event) => event.type === "input");
    expect(typed.map((event) => [event.target?.sensitive === true, event.value])).toEqual([[true, undefined], [false, "Ada"]]);
  });
});
