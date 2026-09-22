import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import type { SpeechGateway } from "./contracts";
import type { SpeechModelStatus, SpeechProgress, SpeechTranscript } from "../domain/speech";
import { GatewayError, mapGatewayError } from "../domain/errors";

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try { return await invoke<T>(command, args); } catch (error) { throw mapGatewayError(error); }
}

export function createTauriSpeechGateway(): SpeechGateway {
  return {
    available: true,
    modelStatus: (model = "small") => call<SpeechModelStatus>("speech_model_status", { model }),
    chooseModel: async (model = "small") => {
      const path = await open({ multiple: false, filters: [{ name: `Whisper ${model} Q5_1`, extensions: ["bin"] }] });
      return typeof path === "string" ? path : null;
    },
    installModel: (requestId, source, model = "small") => call<SpeechModelStatus>("install_speech_model", { requestId, source, model }),
    start: (requestId, model = "small") => call<void>("start_speech_recording", { requestId, model }),
    stop: (requestId, language, context) => call<SpeechTranscript>("stop_speech_recording", { requestId, language, context }),
    cancel: (requestId) => call<void>("cancel_speech", { requestId }),
    format: (settings, text) => call<string>("format_speech_transcript", { settings, text }),
    watchProgress: (onProgress) => listen<SpeechProgress>("speech-progress", (event) => onProgress(event.payload)),
  };
}

export function createUnavailableSpeechGateway(): SpeechGateway {
  const unavailable = async (): Promise<never> => { throw new GatewayError({ code: "io", message: "speech.desktopOnly" }); };
  return {
    available: false, modelStatus: unavailable, chooseModel: unavailable, installModel: unavailable,
    start: unavailable, stop: unavailable, format: unavailable,
    cancel: async () => {}, watchProgress: async () => () => {},
  };
}
