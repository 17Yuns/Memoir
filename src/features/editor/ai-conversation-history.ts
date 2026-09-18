import { useEffect, useSyncExternalStore } from "react";
import type { AiConversation, AiConversationMessage } from "../../domain/ai";
import type { PersistenceGateway } from "../../gateways/contracts";
import { getGateways } from "../../gateways";

type HistorySnapshot = {
  conversations: AiConversation[];
  loaded: boolean;
  error: "load" | "save" | null;
  pendingIds: string[];
};

// Shared across panel mounts: pending replies and ordered writes survive closing the panel.
export function createAiConversationHistory(persistence: PersistenceGateway, root: string) {
  let snapshot: HistorySnapshot = { conversations: [], loaded: false, error: null, pendingIds: [] };
  const listeners = new Set<() => void>();
  let loading: Promise<void> | null = null;
  let writes = Promise.resolve();
  const publish = (next: HistorySnapshot) => {
    snapshot = next;
    listeners.forEach((listener) => listener());
  };
  const save = () => {
    const conversations = snapshot.conversations;
    writes = writes.then(async () => {
      try {
        await persistence.saveAiConversations(root, conversations);
        if (snapshot.conversations === conversations) publish({ ...snapshot, error: null });
      } catch {
        publish({ ...snapshot, error: "save" });
      }
    });
    return writes;
  };
  const load = () => {
    if (snapshot.loaded) return Promise.resolve();
    if (loading) return loading;
    loading = persistence.loadAiConversations(root).then((conversations) => {
      publish({ ...snapshot, conversations: conversations.sort((a, b) => b.updatedAt - a.updatedAt), loaded: true, error: null });
    }).catch(() => {
      publish({ ...snapshot, error: "load" });
    }).finally(() => { loading = null; });
    return loading;
  };
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    load,
    retry: () => snapshot.loaded ? save() : load(),
    setPending(id: string, pending: boolean) {
      publish({ ...snapshot, pendingIds: [...snapshot.pendingIds.filter((item) => item !== id), ...(pending ? [id] : [])] });
    },
    put(conversation: AiConversation) {
      if (!snapshot.loaded) return;
      publish({ ...snapshot, conversations: [conversation, ...snapshot.conversations.filter((item) => item.id !== conversation.id)]
        .sort((a, b) => b.updatedAt - a.updatedAt) });
      void save();
    },
    complete(id: string, messages: AiConversationMessage[]) {
      const conversation = snapshot.conversations.find((item) => item.id === id);
      // A late reply must never bring a deleted conversation back.
      if (conversation) this.put({ ...conversation, messages, updatedAt: Date.now() });
    },
    remove(id: string) {
      if (!snapshot.loaded) return;
      publish({ ...snapshot, conversations: snapshot.conversations.filter((item) => item.id !== id) });
      void save();
    },
  };
}

const histories = new WeakMap<PersistenceGateway, Map<string, ReturnType<typeof createAiConversationHistory>>>();

export function useAiConversationHistory(root: string | null) {
  const persistence = getGateways().persistence;
  let workspaces = histories.get(persistence);
  if (!workspaces) {
    workspaces = new Map();
    histories.set(persistence, workspaces);
  }
  const key = root ?? "";
  let history = workspaces.get(key);
  if (!history) {
    history = createAiConversationHistory(persistence, key);
    workspaces.set(key, history);
  }
  const snapshot = useSyncExternalStore(history.subscribe, history.getSnapshot);
  useEffect(() => { if (root) void history.load(); }, [history, root]);
  return { history, ...snapshot };
}
