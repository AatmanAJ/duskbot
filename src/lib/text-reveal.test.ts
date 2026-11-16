import { describe, expect, it } from "vitest";
import { closeOpenMarks, nextReveal, REVEAL_MIN_CPS, rehypeRevealWords, revealStep, REVEAL_SPAN_MS, wordCount } from "./text-reveal";

type Node = { type: string; value?: string; tagName?: string; properties?: Record<string, unknown>; children?: Node[] };
const el = (tagName: string, children: Node[], properties: Record<string, unknown> = {}): Node => ({ type: "element", tagName, properties, children });
const txt = (value: string): Node => ({ type: "text", value });
const run = (tree: Node, from: number) => { rehypeRevealWords({ from })()(tree as never); return tree; };
const spans = (node: Node): Node[] => [
  ...(node.tagName === "span" && (node.properties?.className as string[] | undefined)?.includes("md-rv") ? [node] : []),
  ...(node.children ?? []).flatMap(spans),
];
const plain = (node: Node): string => node.type === "text" ? node.value! : (node.children ?? []).map(plain).join("");

describe("nextReveal", () => {
  const text = "Build is green again and the flaky test is pinned now";

  it("always stops at the end of a word", () => {
    for (let shown = 0; shown < text.length; shown += 3) {
      const next = nextReveal(text, shown, 48);
      expect(next === text.length || /\s/.test(text[next]!)).toBe(true);
      expect(next).toBeGreaterThan(shown);
    }
  });

  it("keeps a steady floor pace on a short wait and catches up on a long one", () => {
    expect(nextReveal(text, 0, 1000)).toBeGreaterThanOrEqual(Math.min(text.length, REVEAL_MIN_CPS - 10));
    const long = "word ".repeat(400);
    const step = nextReveal(long, 0, 100);
    // 2000 chars waiting must drain within about 0.7 s, so a 100 ms tick shows well over the floor's 7 chars
    expect(step).toBeGreaterThan(200);
  });

  it("is done once everything shows", () => {
    expect(nextReveal(text, text.length, 48)).toBe(text.length);
  });
});

describe("revealStep", () => {
  it("staggers a few words a beat apart and fits a whole reply inside the span", () => {
    expect(revealStep(1)).toBe(0);
    expect(revealStep(5)).toBeGreaterThan(10);
    expect(revealStep(400) * 400).toBeLessThanOrEqual(REVEAL_SPAN_MS * 3);
  });
});

describe("rehypeRevealWords", () => {
  it("wraps the words from `from` on, numbered from 0, and leaves the earlier ones as plain text", () => {
    const tree = el("root", [el("p", [txt("one two "), el("strong", [txt("three four")]), txt(" five")])]);
    run(tree, 2);
    const wrapped = spans(tree);
    expect(wrapped.map(plain)).toEqual(["three", "four", "five"]);
    expect(wrapped.map((span) => span.properties?.style)).toEqual(["--rv:0", "--rv:1", "--rv:2"]);
    expect(plain(tree)).toBe("one two three four five");
  });

  it("never splits code or math, but counts their words so later indices hold", () => {
    const tree = el("root", [el("p", [txt("run "), el("code", [txt("pnpm test now")]), txt(" then ship")])]);
    run(tree, 0);
    expect(spans(tree).map(plain)).toEqual(["run", "then", "ship"]);
    expect(wordCount("run pnpm test now then ship")).toBe(6);
  });
});

describe("closeOpenMarks", () => {
  it("closes a bold, inline code or fence cut mid-way, and leaves balanced text alone", () => {
    expect(closeOpenMarks("4. **Friday after")).toBe("4. **Friday after**");
    expect(closeOpenMarks("4. **Friday ")).toBe("4. **Friday**");
    expect(closeOpenMarks("ends with **")).toBe("ends with");
    expect(closeOpenMarks("run `pnpm te")).toBe("run `pnpm te`");
    expect(closeOpenMarks("```ts\nconst a")).toBe("```ts\nconst a\n```");
    expect(closeOpenMarks("**done** and `ok`")).toBe("**done** and `ok`");
    expect(closeOpenMarks("a `**` literal")).toBe("a `**` literal");
  });
});
