export function encodeWav(samples: Float32Array, rate: number): Uint8Array {
  const out = Buffer.alloc(44 + samples.length * 2);
  out.write("RIFF", 0);
  out.writeUInt32LE(36 + samples.length * 2, 4);
  out.write("WAVEfmt ", 8);
  out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20);
  out.writeUInt16LE(1, 22);
  out.writeUInt32LE(rate, 24);
  out.writeUInt32LE(rate * 2, 28);
  out.writeUInt16LE(2, 32);
  out.writeUInt16LE(16, 34);
  out.write("data", 36);
  out.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i += 1) {
    const s = Math.max(-1, Math.min(1, samples[i]!));
    out.writeInt16LE(Math.round(s < 0 ? s * 32768 : s * 32767), 44 + i * 2);
  }
  return new Uint8Array(out.buffer, out.byteOffset, out.byteLength);
}

export function resample(samples: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return samples;
  const ratio = from / to;
  const out = new Float32Array(Math.floor(samples.length / ratio));
  for (let i = 0; i < out.length; i += 1) {
    const at = i * ratio;
    const left = Math.floor(at);
    const right = Math.min(left + 1, samples.length - 1);
    out[i] = samples[left]! + (samples[right]! - samples[left]!) * (at - left);
  }
  return out;
}

/** PCM16 or float32 WAV, any rate and channel count, as mono samples at `rate`. */
export function decodeWav(bytes: Uint8Array, rate: number): Float32Array {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (buf.length < 12 || buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("audio must be a WAV file");
  }
  let format = 0;
  let channels = 1;
  let sourceRate = rate;
  let bits = 16;
  let offset = 12;
  while (offset + 8 <= buf.length) {
    const id = buf.toString("ascii", offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === "fmt ") {
      format = buf.readUInt16LE(body);
      channels = buf.readUInt16LE(body + 2);
      sourceRate = buf.readUInt32LE(body + 4);
      bits = buf.readUInt16LE(body + 14);
    } else if (id === "data") {
      const end = Math.min(buf.length, body + size);
      const width = bits / 8;
      const frames = Math.floor((end - body) / (width * channels));
      const mono = new Float32Array(frames);
      for (let f = 0; f < frames; f += 1) {
        let sum = 0;
        for (let c = 0; c < channels; c += 1) {
          const at = body + (f * channels + c) * width;
          sum += format === 3 && bits === 32 ? buf.readFloatLE(at) : bits === 16 ? buf.readInt16LE(at) / 32768 : 0;
        }
        mono[f] = sum / channels;
      }
      return resample(mono, sourceRate, rate);
    }
    offset = body + size + (size % 2);
  }
  throw new Error("the WAV file has no audio data");
}
