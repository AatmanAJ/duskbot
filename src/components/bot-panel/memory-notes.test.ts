import { describe, expect, it } from "vitest";

import { memoryNotes, panelMemoryNotes, withMemoryNote, withoutMemoryNote } from "./memory-notes";

const doc = "# Notes\n- Omkar uses Resolve Studio\n* Likes short replies\nplain line\n  - nested one\n";

describe("the notes in MEMORY.md", () => {
  it("are its bullet lines, each with the line it sits on", () => {
    expect(memoryNotes(doc)).toEqual([
      { line: 1, text: "Omkar uses Resolve Studio" }, { line: 2, text: "Likes short replies" }, { line: 4, text: "nested one" },
    ]);
    expect(memoryNotes("")).toEqual([]);
  });

  it("forget one line and leave every other byte alone", () => {
    expect(withoutMemoryNote(doc, 2)).toBe("# Notes\n- Omkar uses Resolve Studio\nplain line\n  - nested one\n");
    expect(withoutMemoryNote(doc, 3), "a line that is not a note is never removed").toBe(doc);
    expect(withoutMemoryNote(doc, 99)).toBe(doc);
  });

  it("add a note as one bullet at the end, on its own line", () => {
    expect(withMemoryNote(doc, "  Prefers the free version ")).toBe(`${doc}- Prefers the free version\n`);
    expect(withMemoryNote("", "First")).toBe("- First\n");
    expect(withMemoryNote("# Notes", "Two\nlines")).toBe("# Notes\n- Two lines\n");
  });
});

describe("the notes the panel lists", () => {
  const doc = (path: string, text: string) => ({ path, text, hash: "h", exists: true });

  it("leave out lines struck through by a correction or a merge, dated or not", () => {
    const notes = panelMemoryNotes([doc("MEMORY.md", "- ~~Lives in Lisbon~~ · superseded 2026-11-02\n- 2026-10-01 · from chat · ~~Likes tea~~ · merged 2026-11-03\n- Lives in Porto\n")]);
    expect(notes).toEqual([{ path: "MEMORY.md", topic: null, line: 2, text: "Lives in Porto" }]);
  });

  it("name a topic file's notes by its title, else its file name", () => {
    expect(panelMemoryNotes([doc("memory/food.md", "---\ntitle: favourite food\n---\n- Durian\n")])[0]?.topic).toBe("Favourite food");
    expect(panelMemoryNotes([doc("memory/gym-days.md", "- Monday and Thursday\n")])[0]?.topic).toBe("Gym days");
  });

  it("show a topic file without bullets as one note, without its title block", () => {
    expect(panelMemoryNotes([doc("memory/plan.md", "# The plan\n---\ntitle: plan\n---\nShip on Friday.\nThen rest.\n")]))
      .toEqual([{ path: "memory/plan.md", topic: "Plan", line: null, text: "Ship on Friday. Then rest." }]);
    expect(panelMemoryNotes([doc("memory/old.md", "- ~~Gone~~ · superseded 2026-11-02\n")]), "every line struck: nothing to list").toEqual([]);
  });
});
