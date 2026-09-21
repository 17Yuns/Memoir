import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../../domain/settings";
import type { SpeechGateway } from "../../gateways/contracts";
import { SpeechSession } from "./speech-session";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function fixture() {
  const gateway: SpeechGateway = {
    available: true,
    modelStatus: vi.fn().mockResolvedValue({ ready: true, model: "small", bytes: 190085487 }),
    chooseModel: vi.fn().mockResolvedValue(null), installModel: vi.fn(),
    start: vi.fn().mockResolvedValue(undefined), cancel: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue({ text: "今天嗯做两件事。", segments: [] }),
    format: vi.fn().mockResolvedValue("今天做两件事。"),
    watchProgress: vi.fn().mockResolvedValue(vi.fn()),
  };
  const session = new SpeechSession(gateway);
  const options = { language: "zh" as const, ai: { ...DEFAULT_SETTINGS.ai, enabled: true }, organize: true };
  return { gateway, session, options };
}
afterEach(() => vi.useRealTimers());

describe("speech session", () => {
  it("does not auto-start if closed while checking the model", async () => {
    const { session, gateway, options } = fixture();
    const model = deferred<{ ready: boolean; model: string; bytes: number }>();
    vi.mocked(gateway.modelStatus).mockReturnValue(model.promise);
    const task = session.initialize(options);
    await Promise.resolve();
    session.dispose();
    model.resolve({ ready: true, model: "small", bytes: 190085487 });
    await task;
    expect(gateway.start).not.toHaveBeenCalled();
  });
  it("sends only the transcript to the configured model and preserves the original", async () => {
    const { session, gateway, options } = fixture();
    await session.initialize(); await session.start(options); await session.stop();
    expect(gateway.format).toHaveBeenCalledWith(options.ai, "今天嗯做两件事。");
    expect(session.snapshot()).toMatchObject({ phase: "ready", draft: "今天做两件事。" });
    session.select("original");
    expect(session.snapshot().draft).toBe("今天嗯做两件事。");
    session.dispose();
  });

  it("retains manual edits when switching between original and cleaned text", async () => {
    const { session, options } = fixture();
    await session.initialize(); await session.start(options); await session.stop();
    session.edit("edited cleanup"); session.select("original"); session.edit("edited original");
    session.select("formatted"); expect(session.snapshot().draft).toBe("edited cleanup");
    session.select("original"); expect(session.snapshot().draft).toBe("edited original");
    expect(session.snapshot().transcript?.text).toBe("今天嗯做两件事。");
    session.dispose();
  });

  it("keeps the raw text available when cleanup fails and supports retry", async () => {
    const { session, gateway, options } = fixture();
    vi.mocked(gateway.format).mockRejectedValueOnce(new Error("offline"));
    await session.initialize(); await session.start(options); await session.stop();
    expect(session.snapshot()).toMatchObject({ phase: "ready", draft: "今天嗯做两件事。", error: "speech.formatError" });
    await session.format(options.ai);
    expect(session.snapshot()).toMatchObject({ error: "", draft: "今天做两件事。" });
    session.dispose();
  });

  it("does not upload anything when cleanup is disabled", async () => {
    const { session, gateway, options } = fixture();
    await session.initialize(); await session.start({ ...options, organize: false }); await session.stop();
    expect(gateway.format).not.toHaveBeenCalled();
    expect(session.snapshot().draft).toBe("今天嗯做两件事。");
    session.dispose();
  });

  it("cancels a microphone that finishes starting after the dialog was closed", async () => {
    const { session, gateway, options } = fixture();
    const start = deferred<void>();
    vi.mocked(gateway.start).mockReturnValue(start.promise);
    await session.initialize();
    const task = session.start(options);
    session.dispose();
    start.resolve(); await task;
    expect(gateway.cancel).toHaveBeenCalledWith(vi.mocked(gateway.start).mock.calls[0][0]);
    expect(session.snapshot().phase).not.toBe("recording");
  });

  it("discards late transcription and never sends it to the cloud after cancellation", async () => {
    const { session, gateway, options } = fixture();
    const transcription = deferred<{ text: string; segments: [] }>();
    vi.mocked(gateway.stop).mockReturnValue(transcription.promise);
    await session.initialize(); await session.start(options);
    const task = session.stop(); session.cancel();
    transcription.resolve({ text: "late result", segments: [] }); await task;
    expect(session.snapshot().transcript).toBeNull();
    expect(gateway.format).not.toHaveBeenCalled();
    session.dispose();
  });

  it("ignores late cleanup after cancellation and preserves editable raw text", async () => {
    const { session, gateway, options } = fixture();
    const formatted = deferred<string>();
    vi.mocked(gateway.format).mockReturnValue(formatted.promise);
    await session.initialize(); await session.start({ ...options, organize: false }); await session.stop();
    const task = session.format(options.ai);
    session.cancel(); session.edit("edited original");
    formatted.resolve("late cleanup"); await task;
    expect(session.snapshot().draft).toBe("edited original");
    session.dispose();
  });

  it("stops recording at five minutes and prevents duplicate stop requests", async () => {
    vi.useFakeTimers();
    const { session, gateway, options } = fixture();
    await session.initialize(); await session.start(options);
    await vi.advanceTimersByTimeAsync(300000);
    await session.stop();
    expect(gateway.stop).toHaveBeenCalledTimes(1);
    expect(session.snapshot().seconds).toBe(300);
    session.dispose();
  });

  it("cleans up an event subscription that resolves after unmount", async () => {
    const { session, gateway } = fixture();
    const watch = deferred<() => void>();
    const unlisten = vi.fn();
    vi.mocked(gateway.watchProgress).mockReturnValue(watch.promise);
    const task = session.initialize(); session.dispose();
    watch.resolve(unlisten); await task;
    expect(unlisten).toHaveBeenCalledOnce();
    expect(gateway.modelStatus).not.toHaveBeenCalled();
  });
});
