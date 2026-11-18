import { createLocalVoiceRoutes } from "../routes/local-voice.ts";
import type { RouteHandler } from "../routes/table.ts";
import { isBuiltInVoice, loadOrt, LocalVoiceEngine, DEFAULT_VOICE } from "./engine.ts";
import { ModelStore } from "./models.ts";

export function localVoiceRoutes(models = new ModelStore()): RouteHandler {
  const engine = new LocalVoiceEngine(models);
  return createLocalVoiceRoutes({
    available: async () => Boolean(await loadOrt()),
    status: () => models.status(),
    prepare: async () => {
      await models.ensure();
      await engine.warm();
    },
    speak: (text, voice, speed) => engine.speak(text, isBuiltInVoice(voice) ? voice : DEFAULT_VOICE, speed),
    transcribe: (samples) => engine.transcribe(samples),
  });
}
