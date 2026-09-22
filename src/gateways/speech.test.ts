import { describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { DEFAULT_SETTINGS } from "../domain/settings";
import { createTauriSpeechGateway, createUnavailableSpeechGateway } from "./speech";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue("cleaned") }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn().mockResolvedValue(() => {}) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn().mockResolvedValue(null) }));

describe("speech adapters", () => {
  it("passes note hints through the local recognition command", async () => {
    await createTauriSpeechGateway().stop("context-session", "auto", "灰度发布，推理平台");
    expect(invoke).toHaveBeenCalledWith("stop_speech_recording", {
      requestId: "context-session", language: "auto", context: "灰度发布，推理平台",
    });
  });
  it("passes the selected model to status, installation, and recording", async () => {
    const gateway = createTauriSpeechGateway();
    await gateway.modelStatus("base");
    expect(invoke).toHaveBeenCalledWith("speech_model_status", { model: "base" });
    await gateway.installModel("install-base", null, "base");
    expect(invoke).toHaveBeenCalledWith("install_speech_model", { requestId: "install-base", source: null, model: "base" });
    await gateway.start("record-base", "base");
    expect(invoke).toHaveBeenCalledWith("start_speech_recording", { requestId: "record-base", model: "base" });
  });
  it("uses a dedicated text-only cleanup command and existing AI configuration", async () => {
    const gateway = createTauriSpeechGateway();
    await gateway.format(DEFAULT_SETTINGS.ai, "original transcript");
    expect(invoke).toHaveBeenCalledWith("format_speech_transcript", { settings: DEFAULT_SETTINGS.ai, text: "original transcript" });
    await gateway.stop("session-1", "zh");
    expect(invoke).toHaveBeenCalledWith("stop_speech_recording", { requestId: "session-1", language: "zh", context: undefined });
  });
  it("does not pretend the browser demo performs local transcription", async () => {
    const gateway = createUnavailableSpeechGateway();
    expect(gateway.available).toBe(false);
    await expect(gateway.start("test")).rejects.toThrow("speech.desktopOnly");
  });
});
