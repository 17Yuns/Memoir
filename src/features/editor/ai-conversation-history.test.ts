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
    const { persistence } = createMockGateways();
    let finish!: () => void;
    const save = vi.spyOn(persistence, "saveAiConversations").mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const history = createAiConversationHistory(persistence, "/workspace");
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
    const { persistence } = createMockGateways();
    const save = vi.spyOn(persistence, "saveAiConversations").mockRejectedValueOnce(new Error("disk full"));
    const history = createAiConversationHistory(persistence, "/workspace");
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
    const { persistence } = createMockGateways();
    await persistence.saveAiConversations("/workspace", [conversation]);
    vi.spyOn(persistence, "loadAiConversations").mockRejectedValueOnce(new Error("read failed"));
    const save = vi.spyOn(persistence, "saveAiConversations");
    const history = createAiConversationHistory(persistence, "/workspace");
    await history.load();
    history.put({ ...conversation, id: "two" });
    expect(save).not.toHaveBeenCalled();
    expect(history.getSnapshot().error).toBe("load");
    await history.retry();
    expect(history.getSnapshot().conversations).toEqual([conversation]);
  });
});
