import type { LaneState, MissionState, SpanState } from "../../../shared/mission";
import type { LocaleKey } from "@/locales";

export type Led = "live" | "wait" | "you" | "done" | "fail" | "off" | "queued";

const LANE_LED: Record<LaneState, Led> = {
  queued: "queued", working: "live", waiting: "wait", "needs-input": "you", done: "done", failed: "fail", stopped: "off", idle: "off",
};
const MISSION_LED: Record<MissionState, Led> = {
  running: "live", "needs-input": "you", done: "done", "partly-done": "wait", failed: "fail", stopped: "off", idle: "off",
};

export const laneLed = (state: LaneState): Led => LANE_LED[state];
export const missionLed = (state: MissionState): Led => MISSION_LED[state];
export const laneWord = (state: LaneState): LocaleKey => `lane.state.${state}` as LocaleKey;
export const missionWord = (state: MissionState): LocaleKey => `mission.state.${state}` as LocaleKey;
export const spanLed = (state: SpanState): Led => LANE_LED[state];

export function clock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const two = (n: number) => String(n).padStart(2, "0");
  return hours ? `${hours}:${two(minutes)}:${two(seconds)}` : `${minutes}:${two(seconds)}`;
}

export function tickStep(span: number): number {
  const steps = [5_000, 10_000, 15_000, 30_000, 60_000, 120_000, 300_000, 600_000, 900_000, 1_800_000, 3_600_000, 7_200_000, 21_600_000];
  return steps.find((step) => span / step <= 10) ?? 43_200_000;
}

export const placeOn = (at: number, from: number, to: number): number =>
  to <= from ? 0 : Math.min(100, Math.max(0, ((at - from) / (to - from)) * 100));
