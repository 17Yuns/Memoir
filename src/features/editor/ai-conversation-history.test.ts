import { DEFAULT_SETTINGS } from "../../domain/settings";
import { describe, expect, it, vi } from "vitest";
import type { AiConversation } from "../../domain/ai";
import { createMockGateways } from "../../test/mock-gateways";
import { createAiConversationHistory } from "./ai-conversation-history";

const conversation: AiConversation = {
  id: "one", title: "问题", notePath: "notes.md", createdAt: 1, updatedAt: 1,
  messages: [{ role: "user", content: "问题" }],
};

describe("AI conversation persistence", () => {
  it("orders writes so a slow save cannot undo a deletion or restore a late reply", async () => {
    const { persistence, workspace } = createMockGateways();
    let finish!: () => void;
    const save = vi.spyOn(persistence, "saveAiConversations").mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const history = createAiConversationHistory(persistence, "/workspace", workspace);
    await history.load();
    history.put(conversation);
    await Promise.resolve();
    history.remove(conversation.id);
    history.complete(conversation.id, [...conversation.messages, { role: "assistant", content: "晚到的回复" }]);
    expect(save).toHaveBeenCalledTimes(1);
    finish();
    await history.retry();
    expect(await persistence.loadAiConversations("/workspace")).toEqual([]);
    expect(history.getSnapshot().conversations).toEqual([]);
  });

  it("keeps unsaved messages available and retries storage failures", async () => {
    const { persistence, workspace } = createMockGateways();
    const save = vi.spyOn(persistence, "saveAiConversations").mockRejectedValueOnce(new Error("disk full"));
    const history = createAiConversationHistory(persistence, "/workspace", workspace);
    await history.load();
    history.put(conversation);
    await vi.waitFor(() => expect(history.getSnapshot().error).toBe("save"));
    expect(history.getSnapshot().conversations).toEqual([conversation]);
    await history.retry();
    expect(save).toHaveBeenCalledTimes(2);
    expect(history.getSnapshot().error).toBeNull();
    expect(await persistence.loadAiConversations("/workspace")).toEqual([conversation]);
  });

  it("does not overwrite unread history after a load failure", async () => {
    const { persistence, workspace } = createMockGateways();
    await persistence.saveAiConversations("/workspace", [conversation]);
    vi.spyOn(persistence, "loadAiConversations").mockRejectedValueOnce(new Error("read failed"));
    const save = vi.spyOn(persistence, "saveAiConversations");
    const history = createAiConversationHistory(persistence, "/workspace", workspace);
    await history.load();
    history.put({ ...conversation, id: "two" });
    expect(save).not.toHaveBeenCalled();
    expect(history.getSnapshot().error).toBe("load");
    await history.retry();
    expect(history.getSnapshot().conversations).toEqual([conversation]);
  });
});

function backgroundHistory(root = "/workspace") {
  const { persistence, workspace } = createMockGateways();
  type Response = typeof workspace.chatResult;
  type Progress = NonNullable<Parameters<typeof workspace.chatWithNote>[4]>;
  const jobs: { resolve: (response: Response) => void; reject: (error: Error) => void; progress: Progress }[] = [];
  const chat = vi.fn<typeof workspace.chatWithNote>((_root, _settings, _messages, _target, progress) =>
    new Promise<Response>((resolve, reject) => jobs.push({ resolve, reject, progress: progress! })));
  workspace.chatWithNote = chat;
  return { history: createAiConversationHistory(persistence, root, workspace), jobs, chat, persistence };
}

const request = {
  id: null, prompt: "后台问题", target: { path: "one.md", from: 0, to: 3, source: "old", scope: "document" as const },
  settings: DEFAULT_SETTINGS.ai, fallbackReply: "AI 助手",
};

describe("background AI conversations", () => {
  it("runs concurrent sessions without subscribers and isolates streams, context and results", async () => {
    const { history, jobs, chat, persistence } = backgroundHistory();
    await history.load();
    const first = history.send(request)!;
    history.newConversation(null);
    const second = history.send({ ...request, prompt: "第二个问题", target: { ...request.target, path: "two.md" } })!;
    expect(chat).toHaveBeenCalledTimes(2);
    jobs[0].progress({ stage: "receiving", contentDelta: '{"message":"第一段' });
    jobs[1].progress({ stage: "reasoning", reasoningDelta: "第二段思考" });
    expect(history.getSnapshot().sessions[first].task?.raw).toContain("第一段");
    expect(history.getSnapshot().sessions[second].task?.reasoning).toBe("第二段思考");
    expect(history.getSnapshot().sessions[second].task?.raw).toBe("");
    expect(history.getSnapshot().sessions[first].contextTarget?.path).toBe("one.md");
    expect(chat.mock.calls[1][2]).toEqual([{ role: "user", content: "第二个问题" }]);
    jobs[1].resolve({ message: "第二个回答", edit: null });
    await vi.waitFor(() => expect(history.getSnapshot().sessions[second].task?.status).toBe("completed"));
    expect(history.getSnapshot().sessions[first].task?.status).toBe("running");
    jobs[0].resolve({ message: "第一个回答", edit: { tool: "replace_document", replacement: "new" } });
    await vi.waitFor(() => expect(history.getSnapshot().sessions[first].task?.status).toBe("completed"));
    expect(history.getSnapshot().activeId).toBe(second);
    expect(history.getSnapshot().sessions[first].pendingEdit).toEqual({ ...request.target, replacement: "new" });
    expect(history.getSnapshot().sessions[second].pendingEdit).toBeNull();
    await history.retry();
    const saved = await persistence.loadAiConversations("/workspace");
    expect(saved.find((item) => item.id === first)?.messages[1]?.content).toBe("第一个回答");
    expect(saved.find((item) => item.id === second)?.messages[1]?.content).toBe("第二个回答");
  });

  it("blocks duplicate requests only within the same session and retains failures for returning users", async () => {
    const { history, jobs, chat } = backgroundHistory();
    await history.load();
    const first = history.send(request)!;
    expect(history.send({ ...request, id: first })).toBeUndefined();
    history.newConversation(null);
    const second = history.send({ ...request, prompt: "另一个问题" })!;
    jobs[0].reject(new Error("model unavailable"));
    await vi.waitFor(() => expect(history.getSnapshot().sessions[first].task?.status).toBe("failed"));
    expect(history.getSnapshot().sessions[first].task?.error?.message).toBe("model unavailable");
    expect(history.getSnapshot().sessions[second].task?.status).toBe("running");
    history.select(first);
    history.send({ ...request, id: first, prompt: "重试" });
    expect(chat).toHaveBeenCalledTimes(3);
    expect(history.getSnapshot().sessions[first].task?.error).toBeNull();
    jobs[1].resolve({ message: "完成二", edit: null });
    jobs[2].resolve({ message: "重试完成", edit: null });
    await vi.waitFor(() => expect(history.getSnapshot().sessions[first].task?.status).toBe("completed"));
  });

  it("ignores all late events after a running conversation is deleted", async () => {
    const { history, jobs, persistence } = backgroundHistory();
    await history.load();
    const id = history.send(request)!;
    history.remove(id);
    jobs[0].progress({ stage: "receiving", contentDelta: "late chunk" });
    jobs[0].resolve({ message: "late answer", edit: { tool: "replace_document", replacement: "late edit" } });
    await Promise.resolve();
    await history.retry();
    expect(history.getSnapshot().sessions[id]).toBeUndefined();
    expect(history.getSnapshot().activeId).toBeNull();
    expect(await persistence.loadAiConversations("/workspace")).toEqual([]);
  });
});
