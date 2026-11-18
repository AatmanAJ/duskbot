import { describe, expect, it } from "vitest";

import { moveBackLine } from "./TransferSettings";

describe("moveBackLine", () => {
  it("says each step of bringing bots back, with the copy's size when known", () => {
    expect(moveBackLine({ step: "check", status: "running" }, "Mac")).toBe("Getting ready…");
    expect(moveBackLine({ step: "pause", status: "running", name: "box" }, "Mac")).toBe("Pausing the bots on box…");
    expect(moveBackLine({ step: "backup-here", status: "running", name: "box" }, "Mac")).toBe("Saving a backup of this Mac…");
    expect(moveBackLine({ step: "copy", status: "running", name: "box", bytes: { done: 5, total: 10 } }, "Mac", (n) => `${n} B`)).toBe("Copying everything from box: 5 B of 10 B");
    expect(moveBackLine({ step: "copy", status: "running", name: "box", bytes: { done: 5 } }, "Mac")).toBe("Copying everything from box…");
  });

  it("says nothing once it ended or when none runs", () => {
    expect(moveBackLine(undefined, "Mac")).toBeNull();
    expect(moveBackLine({ step: "copy", status: "failed", name: "box", error: "No." }, "Mac")).toBeNull();
  });
});
