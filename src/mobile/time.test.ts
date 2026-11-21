import { beforeEach, describe, expect, it, vi } from "vitest";

const device = vi.hoisted(() => ({ cycle: "h23" as Intl.DateTimeFormatOptions["hourCycle"] }));
vi.mock("@/lib/format-time", async (original) => ({ ...await original<typeof import("@/lib/format-time")>(), deviceHourCycle: () => device.cycle }));

import { clock } from "@/lib/automations";
import { routineDateTime } from "@/lib/routine-display";
import { listTime } from "./time";

const evening = new Date(2026, 10, 18, 23, 30).getTime();

describe("times on the phone", () => {
  beforeEach(() => { device.cycle = "h23"; });

  it("follow the device's 24 hour clock in the chat list, a routine's schedule and its next run alike", () => {
    expect(listTime(evening, evening)).toBe("23:30");
    expect(clock(evening)).toBe("23:30");
    expect(routineDateTime(evening)).toContain("23:30");
  });

  it("never write an hour alone on a 24 hour clock, as \"every weekday at 07\"", () => {
    const seven = new Date(2026, 10, 18, 7, 0).getTime();
    expect(clock(seven, true)).toBe("07:00");
    device.cycle = "h12";
    expect(clock(seven, true)).toMatch(/^7\sAM$/);
  });

  it("follow the device's 12 hour clock just as consistently", () => {
    device.cycle = "h12";
    for (const text of [listTime(evening, evening), clock(evening), routineDateTime(evening)]) expect(text).toMatch(/11:30\sPM/);
  });
});
