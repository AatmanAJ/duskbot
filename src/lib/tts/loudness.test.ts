import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

function fakeWebAudio() {
  const connect = vi.fn();
  const node = () => ({ connect, threshold: { value: 0 }, knee: { value: 0 }, ratio: { value: 0 }, attack: { value: 0 }, release: { value: 0 }, gain: { value: 0 } });
  const createMediaElementSource = vi.fn(() => ({ connect }));
  class FakeContext {
    destination = {};
    createDynamicsCompressor = node;
    createGain = node;
    createMediaElementSource = createMediaElementSource;
    resume = vi.fn(async () => {});
  }
  vi.stubGlobal("AudioContext", FakeContext);
  return createMediaElementSource;
}

describe("read aloud loudness", () => {
  it("plays the iPhone app's audio as it is, so the silent switch and a suspended context never mute it", async () => {
    const routed = fakeWebAudio();
    vi.stubGlobal("document", { documentElement: { dataset: { mobileApp: "ios" } } });
    const { playLouder } = await import("./loudness");
    playLouder({} as HTMLAudioElement);
    expect(routed).not.toHaveBeenCalled();
  });

  it("evens out the loudness everywhere else", async () => {
    const routed = fakeWebAudio();
    vi.stubGlobal("document", { documentElement: { dataset: {} } });
    const { playLouder } = await import("./loudness");
    playLouder({} as HTMLAudioElement);
    expect(routed).toHaveBeenCalledOnce();
  });
});
