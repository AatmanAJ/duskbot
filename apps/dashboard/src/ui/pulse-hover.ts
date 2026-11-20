import { PULSE_INTERVAL_MS, type PulseSample } from "../../../../shared/machine-pulse";

/** the sample nearest to time `at`, or null when the pointer sits in a gap more than two intervals from any sample */
export function nearestSample(samples: readonly PulseSample[], at: number): PulseSample | null {
  let best: PulseSample | null = null;
  for (const s of samples) if (!best || Math.abs(s.t - at) < Math.abs(best.t - at)) best = s;
  return best && Math.abs(best.t - at) <= 2 * PULSE_INTERVAL_MS ? best : null;
}
