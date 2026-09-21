import { EditorState } from "@codemirror/state";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../domain/settings";
import type { EchoContext } from "../domain/echo";
import type { SemanticSearchResult } from "../domain/vector-index";
import { EchoSession, echoCandidates } from "./echo-session";

const env = { root: "/vault", path: "source.md", title: "Source", settings: DEFAULT_SETTINGS.ai, indexKey: "1", enabled: true };
const context = (text = "A long enough paragraph to search.", composing = false): EchoContext => ({ sourcePath: "source.md", version: {}, doc: EditorState.create({ doc: text }).doc,
  anchor: 0, head: 0, from: 0, to: 0, text, kind: "paragraph", composing });
const result = (relativePath: string, score = 0.9): SemanticSearchResult => ({ relativePath, score, title: relativePath, content: "Matched chunk", excerpt: "Generic summary", chunkIndex: 0 });
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0); });
afterEach(() => vi.useRealTimers());

describe("Echo scheduling", () => {
  it("debounces composition and selection, uses the title, and caches only the last query", async () => {
    const search = vi.fn().mockResolvedValue([result("other.md")]);
    const session = new EchoSession(search);
    session.configure(env);
    session.setContext(context("中文输入还没有结束的文字", true));
    await vi.advanceTimersByTimeAsync(3000);
    expect(search).not.toHaveBeenCalled();
    session.setContext(context());
    await vi.advanceTimersByTimeAsync(1999);
    expect(search).not.toHaveBeenCalled();
    session.setContext(context());
    await vi.advanceTimersByTimeAsync(2000);
    expect(search).toHaveBeenCalledWith(env.root, env.settings, "Source\n\nA long enough paragraph to search.", 20);
    session.setContext(context());
    await vi.advanceTimersByTimeAsync(20000);
    expect(search).toHaveBeenCalledTimes(1);
    session.pause();
  });
  it("keeps only the latest queued context and prevents stale responses or concurrent requests", async () => {
    let resolve!: (results: SemanticSearchResult[]) => void;
    const search = vi.fn().mockImplementationOnce(() => new Promise<SemanticSearchResult[]>((done) => { resolve = done; }))
      .mockResolvedValue([result("latest.md")]);
    const session = new EchoSession(search);
    session.configure(env);
    session.setContext(context());
    await vi.advanceTimersByTimeAsync(2000);
    session.refresh();
    await vi.advanceTimersByTimeAsync(0);
    expect(search).toHaveBeenCalledTimes(1);
    session.setContext(context("Intermediate paragraph with enough text"));
    session.setContext(context("Latest paragraph with enough text"));
    await vi.advanceTimersByTimeAsync(4000);
    resolve([result("stale.md")]);
    await vi.advanceTimersByTimeAsync(0);
    expect(session.getSnapshot().results).toEqual([]);
    await vi.advanceTimersByTimeAsync(5999);
    expect(search).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(search).toHaveBeenCalledTimes(2);
    expect(search.mock.calls[1][2]).toContain("Latest paragraph");
    expect(session.getSnapshot().results[0].relativePath).toBe("latest.md");
  });
  it("allows manual refresh, keeps old results on error and never retries in a loop", async () => {
    const search = vi.fn().mockResolvedValueOnce([result("previous.md")]).mockRejectedValue(new Error("offline"));
    const session = new EchoSession(search);
    session.configure(env); session.setContext(context());
    await vi.advanceTimersByTimeAsync(2000);
    session.refresh(); await vi.advanceTimersByTimeAsync(0);
    expect(search).toHaveBeenCalledTimes(2);
    expect(session.getSnapshot()).toMatchObject({ error: true, results: [result("previous.md")] });
    await vi.advanceTimersByTimeAsync(100000);
    expect(search).toHaveBeenCalledTimes(2);
  });
  it("stops when hidden, clears results on note/config/index switches, and resumes current context", async () => {
    const search = vi.fn().mockResolvedValue([result("other.md")]);
    const session = new EchoSession(search);
    session.configure(env); session.setContext(context()); session.pause();
    await vi.advanceTimersByTimeAsync(10000);
    expect(search).not.toHaveBeenCalled();
    session.configure(env); await vi.advanceTimersByTimeAsync(2000);
    expect(search).toHaveBeenCalledTimes(1);
    session.configure({ ...env, indexKey: "2" });
    expect(session.getSnapshot().results).toEqual([]);
    await vi.advanceTimersByTimeAsync(10000);
    expect(search).toHaveBeenCalledTimes(2);
    session.configure({ ...env, root: "/another-vault" });
    expect(session.getSnapshot().results).toEqual([]);
    session.configure({ ...env, path: "new.md" });
    await vi.advanceTimersByTimeAsync(10000);
    expect(search).toHaveBeenCalledTimes(2);
  });
  it("filters invalid scores and the current note and deduplicates the best two", () => {
    expect(echoCandidates([result("source.md", 1), result("a.md", .2), result("a.md", .8), result("nan.md", NaN),
      result("infinite.md", Infinity), result("b.md", .7), result("c.md", -.1), result("d.md", -.2)], "source.md")
      .map((item) => [item.relativePath, item.score])).toEqual([["a.md", .8], ["b.md", .7]]);
  });
  it("retains the last query across panel remounts and invalidates it for model changes", async () => {
    const search = vi.fn().mockResolvedValue([result("other.md")]);
    const session = new EchoSession(search);
    session.configure(env); session.setContext(context());
    await vi.advanceTimersByTimeAsync(2000);
    session.pause();
    session.configure({ ...env, enabled: false, indexKey: "" });
    session.configure(env);
    await vi.advanceTimersByTimeAsync(20000);
    expect(search).toHaveBeenCalledTimes(1);
    session.configure({ ...env, settings: { ...env.settings, embeddingModel: "different" } });
    expect(session.getSnapshot().results).toEqual([]);
    await vi.advanceTimersByTimeAsync(2000);
    expect(search).toHaveBeenCalledTimes(2);
  });
  it("keeps previous results while loading and drops a response received while hidden", async () => {
    let finish!: (results: SemanticSearchResult[]) => void;
    const search = vi.fn().mockResolvedValueOnce([result("previous.md")]).mockImplementationOnce(() =>
      new Promise<SemanticSearchResult[]>((resolve) => { finish = resolve; }));
    const session = new EchoSession(search);
    session.configure(env); session.setContext(context());
    await vi.advanceTimersByTimeAsync(2000);
    session.setContext(context("Changed paragraph to query next"));
    await vi.advanceTimersByTimeAsync(10000);
    expect(session.getSnapshot()).toMatchObject({ loading: true, results: [result("previous.md")] });
    session.pause(); finish([result("hidden.md")]);
    await vi.advanceTimersByTimeAsync(20000);
    expect(session.getSnapshot()).toMatchObject({ loading: false, results: [result("previous.md")] });
    expect(search).toHaveBeenCalledTimes(2);
  });
});
