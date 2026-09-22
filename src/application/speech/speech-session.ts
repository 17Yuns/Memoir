import type { AiSettings } from "../../domain/ai";
import { mapGatewayError } from "../../domain/errors";
import { MAX_RECORDING_SECONDS, type SpeechLanguage, type SpeechModel, type SpeechModelStatus, type SpeechTranscript } from "../../domain/speech";
import type { SpeechGateway } from "../../gateways/contracts";

export type SpeechPhase = "checking" | "idle" | "downloading" | "starting" | "recording" | "transcribing" | "formatting" | "ready";
type RecordingOptions = { language: SpeechLanguage; ai: AiSettings; organize: boolean; context?: string };
export type SpeechState = {
  phase: SpeechPhase;
  model: SpeechModelStatus | null;
  progress: number;
  seconds: number;
  transcript: SpeechTranscript | null;
  formatted: string;
  originalDraft: string;
  draft: string;
  variant: "original" | "formatted";
  error: string;
};
const initialState: SpeechState = {
  phase: "checking", model: null, progress: 0, seconds: 0, transcript: null,
  formatted: "", originalDraft: "", draft: "", variant: "original", error: "",
};

/** Owns one dialog's asynchronous work. Generations discard replies after cancel/unmount. */
export class SpeechSession {
  private state: SpeechState = { ...initialState };
  private listeners = new Set<() => void>();
  private generation = 0;
  private disposed = false;
  private requestId: string | null = null;
  private unlisten?: () => void;
  private timer?: ReturnType<typeof setInterval>;
  private options?: RecordingOptions;

  constructor(readonly gateway: SpeechGateway, readonly model: SpeechModel = "small") {}
  snapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(patch: Partial<SpeechState>) {
    if (this.disposed) return;
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener());
  }
  private valid(generation: number) { return !this.disposed && generation === this.generation; }
  private clearTimer() { if (this.timer) clearInterval(this.timer); this.timer = undefined; }
  private cancelNative(id: string) { void this.gateway.cancel(id).catch(() => undefined); }

  async initialize(recordingOptions?: RecordingOptions) {
    this.disposed = false;
    const generation = ++this.generation;
    if (!this.gateway.available) { this.update({ phase: "idle", error: "speech.desktopOnly" }); return; }
    try {
      const unlisten = await this.gateway.watchProgress((event) => {
        if (event.requestId !== this.requestId || event.stage !== this.state.phase) return;
        this.update({ progress: Math.max(0, Math.min(100, event.progress)) });
      });
      if (!this.valid(generation)) { unlisten(); return; }
      this.unlisten = unlisten;
      const model = await this.gateway.modelStatus(this.model);
      if (this.valid(generation)) {
        this.update({ model, phase: "idle", error: "" });
        if (recordingOptions && this.valid(generation)) await this.start(recordingOptions);
      }
    } catch { if (this.valid(generation)) this.update({ phase: "idle", error: "speech.setupError" }); }
  }

  async install(importFile = false) {
    if (!["idle", "ready"].includes(this.state.phase)) return;
    const generation = ++this.generation;
    this.update({ phase: "downloading", progress: 0, error: "" });
    try {
      const source = importFile ? await this.gateway.chooseModel(this.model) : null;
      if (!this.valid(generation)) return;
      if (importFile && !source) { this.update({ phase: "idle" }); return; }
      const id = crypto.randomUUID();
      this.requestId = id;
      const model = await this.gateway.installModel(id, source, this.model);
      if (this.valid(generation)) this.update({ model, phase: "idle", progress: 100 });
    } catch (error) {
      if (this.valid(generation)) this.update({ phase: "idle", error: mapGatewayError(error).message });
    } finally { if (this.valid(generation)) this.requestId = null; }
  }

  async start(options: RecordingOptions) {
    if (!this.state.model?.ready || !["idle", "ready"].includes(this.state.phase)) return;
    const generation = ++this.generation;
    const id = crypto.randomUUID();
    this.requestId = id;
    this.options = { ...options, ai: { ...options.ai } };
    this.update({ phase: "starting", transcript: null, formatted: "", originalDraft: "", draft: "", error: "", seconds: 0, progress: 0 });
    try {
      await this.gateway.start(id, this.model);
      if (!this.valid(generation)) { this.cancelNative(id); return; }
      const started = Date.now();
      this.update({ phase: "recording" });
      this.timer = setInterval(() => {
        const seconds = Math.min(MAX_RECORDING_SECONDS, Math.floor((Date.now() - started) / 1000));
        this.update({ seconds });
        if (seconds >= MAX_RECORDING_SECONDS) void this.stop();
      }, 250);
    } catch (error) {
      this.cancelNative(id);
      if (this.valid(generation)) { this.requestId = null; this.update({ phase: "idle", error: mapGatewayError(error).message }); }
    }
  }

  async stop() {
    if (this.state.phase !== "recording" || !this.requestId || !this.options) return;
    this.clearTimer();
    const generation = this.generation;
    const id = this.requestId;
    const options = this.options;
    this.update({ phase: "transcribing", progress: 0 });
    try {
      const transcript = await this.gateway.stop(id, options.language, options.context);
      if (!this.valid(generation)) return;
      this.requestId = null;
      this.update({ transcript, originalDraft: transcript.text, draft: transcript.text, variant: "original", phase: "ready" });
      if (options.organize && options.ai.enabled) await this.format(options.ai);
    } catch (error) {
      if (this.valid(generation)) this.update({ phase: "idle", error: mapGatewayError(error).message });
    } finally { if (this.valid(generation)) this.requestId = null; }
  }

  async format(ai: AiSettings) {
    const text = this.state.transcript?.text;
    if (!text || this.state.phase !== "ready") return;
    const generation = ++this.generation;
    this.update({ phase: "formatting", error: "" });
    try {
      const formatted = await this.gateway.format({ ...ai }, text);
      if (this.valid(generation)) this.update({ formatted, draft: formatted, variant: "formatted", phase: "ready" });
    } catch {
      if (this.valid(generation)) this.update({ phase: "ready", error: "speech.formatError" });
    }
  }

  select(variant: "original" | "formatted") {
    if (this.state.phase !== "ready") return;
    this.update({ variant, draft: variant === "original" ? this.state.originalDraft : this.state.formatted });
  }
  edit(draft: string) {
    this.update({ draft, ...(this.state.variant === "original" ? { originalDraft: draft } : { formatted: draft }) });
  }
  cancel() {
    ++this.generation;
    this.clearTimer();
    if (this.requestId) this.cancelNative(this.requestId);
    this.requestId = null;
    this.update({ phase: this.state.transcript ? "ready" : "idle", error: "" });
  }
  dispose() {
    this.cancel();
    this.disposed = true;
    this.unlisten?.();
    this.unlisten = undefined;
  }
}
