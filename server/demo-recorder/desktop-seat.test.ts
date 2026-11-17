import { describe, expect, it } from "vitest";

import type { DesktopTools } from "./accessibility/os.ts";
import type { RawInput } from "./capture.ts";
import { createDesktopTaps, desktopDemoSeat, desktopFrame } from "./desktop-seat.ts";
import { blankPicture, encodePng } from "./testing/png.ts";

const key = (down: boolean, keysym: number) => { const bytes = Buffer.alloc(8); bytes[0] = 4; bytes[1] = down ? 1 : 0; bytes.writeUInt32BE(keysym, 4); return bytes; };
const pointer = (mask: number, x: number, y: number) => { const bytes = Buffer.alloc(6); bytes[0] = 5; bytes[1] = mask; bytes.writeUInt16BE(x, 2); bytes.writeUInt16BE(y, 4); return bytes; };
const opening = Buffer.concat([Buffer.from("RFB 003.008\n", "latin1"), Buffer.from([2]), Buffer.alloc(16, 9), Buffer.from([1])]);

describe("desktop viewers' input while a task is shown", () => {
  it("reaches the listener of that screen only, from every viewer of it, past each one's handshake", () => {
    const taps = createDesktopTaps();
    const heard: RawInput[] = [];
    taps.listen("local/bot-a", (raw) => heard.push(raw));
    const first = taps.tap("local/bot-a");
    const second = taps.tap("local/bot-a");
    const other = taps.tap("local/bot-b");
    first(Buffer.concat([opening, pointer(1, 10, 20)]));
    second(key(true, 0x68));
    other(Buffer.concat([opening, key(true, 0x7a)]));

    expect(heard).toEqual([{ type: "pointer", action: "down", x: 10, y: 20, button: "left" }, { type: "key", action: "down", key: "h", text: "h" }]);
  });

  it("goes nowhere before a listener is set and after it is taken away", () => {
    const taps = createDesktopTaps();
    const viewer = taps.tap("vps/bot-a");
    const heard: RawInput[] = [];
    viewer(Buffer.concat([opening, key(true, 0x61)]));
    taps.listen("vps/bot-a", (raw) => heard.push(raw));
    viewer(key(true, 0x62));
    taps.listen("vps/bot-a", null);
    viewer(key(true, 0x63));

    expect(heard).toEqual([{ type: "key", action: "down", key: "b", text: "b" }]);
  });
});

describe("the seat a task is shown at on a bot's desktop", () => {
  const tools = (): DesktopTools => ({
    async call(tool) {
      if (tool === "list_windows") return { windows: [{ pid: 5, window_id: 2, title: "Notes", app_name: "Notes", bounds: { x: 0, y: 0, width: 640, height: 480 }, z_index: 1 }] };
      return { elements: [{ element_token: "t0", role: "AXTextField", label: "Title", value: "", frame: { x: 10, y: 10, w: 200, h: 24 } }] };
    },
    frame: async () => ({ data: encodePng(blankPicture(8, 6, [1, 2, 3])), type: "image/png", width: 8, height: 6 }),
  });

  it("hands the recording what the viewers do, and tells its probe so focus can be followed", async () => {
    const taps = createDesktopTaps();
    const seat = desktopDemoSeat(tools(), "local/bot-a", taps);
    const recorded: RawInput[] = [];
    seat.tap({ input: async (raw) => { recorded.push(raw); } });
    const viewer = taps.tap("local/bot-a");
    expect(await seat.probe.focused()).toBeNull();
    viewer(Buffer.concat([opening, pointer(1, 50, 20), pointer(0, 50, 20), key(true, 0x68)]));

    expect(recorded.map((raw) => raw.type)).toEqual(["pointer", "pointer", "key"]);
    expect(await seat.probe.focused()).toMatchObject({ role: "textbox", name: "Title" });
    expect(seat.probe.kind).toBe("os");
    expect(seat.surface.accessibility).toBe("os");
    expect((await seat.screen.frame())!.width).toBe(8);

    seat.close!();
    viewer(key(true, 0x69));
    expect(recorded).toHaveLength(3);
  });
});

describe("a desktop's picture", () => {
  it("is read with its size from a PNG or a JPEG, and refused when it is neither", () => {
    const png = encodePng(blankPicture(40, 30, [9, 9, 9]));
    expect(desktopFrame(png.toString("base64"))).toMatchObject({ type: "image/png", width: 40, height: 30 });
    expect(desktopFrame(Buffer.from("not a picture").toString("base64"))).toBeNull();
    expect(desktopFrame("")).toBeNull();
  });
});
