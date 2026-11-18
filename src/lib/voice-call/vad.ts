export interface VadTuning {
  /** dB over the room's noise floor that counts as a voice. */
  marginDb: number;
  /** Stricter while the bot talks, so what is left of its echo never cuts it off. */
  bargeMarginDb: number;
  /** Voice must last this long to start a turn. */
  startMs: number;
  bargeStartMs: number;
  /** Quiet this long ends the turn. */
  endMs: number;
  /** Below this a sound is never a voice, however quiet the room. */
  minLevelDb: number;
  /** The first moments only learn the room. */
  calibrateMs: number;
}

export const DEFAULT_TUNING: VadTuning = {
  marginDb: 11,
  bargeMarginDb: 17,
  startMs: 90,
  bargeStartMs: 200,
  endMs: 640,
  minLevelDb: -52,
  calibrateMs: 320,
};

export type VadEvent = "start" | "end" | null;

export function levelDb(frame: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < frame.length; i += 1) sum += frame[i]! * frame[i]!;
  const rms = Math.sqrt(sum / Math.max(1, frame.length));
  return rms > 0 ? 20 * Math.log10(rms) : -100;
}

export class Vad {
  floorDb = -60;
  speaking = false;
  private voicedMs = 0;
  private quietMs = 0;
  /** When the last voiced frame ended, in the caller's clock. */
  lastVoiceAt = 0;
  private readonly tuning: VadTuning;

  constructor(tuning: Partial<VadTuning> = {}) {
    this.tuning = { ...DEFAULT_TUNING, ...tuning };
  }

  get endMs(): number {
    return this.tuning.endMs;
  }

  reset(): void {
    this.speaking = false;
    this.voicedMs = 0;
    this.quietMs = 0;
  }

  private heardMs = 0;

  feed(level: number, frameMs: number, now: number, botSpeaking = false): VadEvent {
    if (this.heardMs < this.tuning.calibrateMs) {
      const weight = frameMs / (this.heardMs + frameMs);
      this.floorDb = this.heardMs === 0 ? Math.max(-80, Math.min(-30, level)) : Math.max(-80, Math.min(-30, this.floorDb + (level - this.floorDb) * weight));
      this.heardMs += frameMs;
      return null;
    }
    const margin = botSpeaking ? this.tuning.bargeMarginDb : this.tuning.marginDb;
    const voiced = level >= Math.max(this.floorDb + margin, this.tuning.minLevelDb);
    if (!voiced && !this.speaking) {
      const rate = level < this.floorDb ? 0.25 : 0.02;
      this.floorDb = Math.min(-30, Math.max(-80, this.floorDb + (level - this.floorDb) * rate));
    }
    if (voiced) {
      this.voicedMs += frameMs;
      this.quietMs = 0;
      this.lastVoiceAt = now;
      const needed = botSpeaking ? this.tuning.bargeStartMs : this.tuning.startMs;
      if (!this.speaking && this.voicedMs >= needed) {
        this.speaking = true;
        return "start";
      }
      return null;
    }
    this.quietMs += frameMs;
    if (!this.speaking) {
      this.voicedMs = Math.max(0, this.voicedMs - frameMs * 2);
      return null;
    }
    if (this.quietMs >= this.tuning.endMs) {
      this.speaking = false;
      this.voicedMs = 0;
      return "end";
    }
    return null;
  }
}

const TRAILING = /\b(?:and|but|so|or|because|um+|uh+|like|the|a|an|to|with|of|for|if|then|which|that)[,.…]?$/i;

/** A turn that stops on one of these words is usually a pause for thought, not the end. */
export function soundsUnfinished(text: string): boolean {
  return TRAILING.test(text.trim());
}
