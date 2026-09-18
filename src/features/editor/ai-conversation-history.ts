import { useEffect, useSyncExternalStore } from "react";
import {
  citationTitleFromPath, selectUsedNoteCitations,
  type AiConversation, type AiConversationMessage, type AiChatProgress,
  type AiEditorEdit, type AiRewriteTarget, type AiSettings,
} from "../../domain/ai";
import { mapGatewayError, type GatewayError } from "../../domain/errors";
import type { PersistenceGateway, WorkspaceGateway } from "../../gateways/contracts";
import { getGateways } from "../../gateways";

export type AiConversationTask = {
  requestId: string;
  status: "running" | "completed" | "failed";
  startedAt: number;
  finishedAt?: number;
  progress: AiChatProgress;
  raw: string;
  reasoning: string;
  activity: NonNullable<AiConversationMessage["activity"]>;
  error: GatewayError | null;
};

export type AiConversationSession = {
  draft: string;
  contextTarget?: AiRewriteTarget | null;
  includeContext: boolean;
  pendingEdit: AiEditorEdit | null;
  task: AiConversationTask | null;
};

export const EMPTY_AI_SESSION: AiConversationSession = {
  draft: "", includeContext: true, pendingEdit: null, task: null,
};

type HistorySnapshot = {
  conversations: AiConversation[];
  loaded: boolean;
  error: "load" | "save" | null;
  activeId: string | null;
  sessions: Record<string, AiConversationSession>;
  draftSession: AiConversationSession;
};

// Shared across panel mounts: pending replies and ordered writes survive closing the panel.
export function createAiConversationHistory(
  persistence: PersistenceGateway,
  root: string,
  workspace: Pick<WorkspaceGateway, "chatWithNote">,
) {
  let snapshot: HistorySnapshot = { conversations: [], loaded: false, error: null, activeId: null, sessions: {}, draftSession: { ...EMPTY_AI_SESSION } };
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
  const history = {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    load,
    retry: () => snapshot.loaded ? save() : load(),
    select(id: string | null) {
      publish({ ...snapshot, activeId: id });
    },
    newConversation(target: AiRewriteTarget | null) {
      publish({ ...snapshot, activeId: null, draftSession: { ...EMPTY_AI_SESSION, contextTarget: target } });
    },
    updateSession(id: string | null, patch: Partial<AiConversationSession>) {
      if (id === null) {
        publish({ ...snapshot, draftSession: { ...snapshot.draftSession, ...patch } });
      } else {
        publish({ ...snapshot, sessions: { ...snapshot.sessions, [id]: { ...(snapshot.sessions[id] ?? EMPTY_AI_SESSION), ...patch } } });
      }
    },
    send(input: {
      id: string | null;
      prompt: string;
      target: AiRewriteTarget | null;
      settings: AiSettings;
      fallbackReply: string;
    }) {
      const session = input.id === null ? snapshot.draftSession : snapshot.sessions[input.id] ?? EMPTY_AI_SESSION;
      if (!snapshot.loaded || !root || !input.prompt.trim() || session.task?.status === "running") return;
      const id = input.id ?? crypto.randomUUID();
      const previous = snapshot.conversations.find((item) => item.id === id);
      const messages: AiConversationMessage[] = [...(previous?.messages ?? []), { role: "user", content: input.prompt.trim() }];
      const startedAt = Date.now();
      const originalTarget = input.target ? { ...input.target } : null;
      const edit = session.pendingEdit;
      const requestTarget = !session.includeContext ? null : edit
        ? { ...edit, to: edit.from + edit.replacement.length, source: edit.replacement }
        : originalTarget;
      let task: AiConversationTask = {
        requestId: crypto.randomUUID(), status: "running", startedAt,
        progress: { stage: "preparing" }, raw: "", reasoning: "", activity: [], error: null,
      };
      history.put({
        id, title: previous?.title ?? input.prompt.trim().replace(/\s+/g, " ").slice(0, 60),
        notePath: previous?.notePath ?? originalTarget?.path ?? null,
        createdAt: previous?.createdAt ?? startedAt, updatedAt: startedAt, messages,
      });
      history.updateSession(id, { ...session, draft: "", contextTarget: originalTarget, task });
      publish({ ...snapshot, activeId: id,
        draftSession: input.id === null ? { ...EMPTY_AI_SESSION } : snapshot.draftSession });
      const isCurrent = () => snapshot.sessions[id]?.task?.requestId === task.requestId
        && snapshot.sessions[id]?.task?.status === "running";
      // The task owns the gateway promise and stream subscription, never a mounted panel.
      void (async () => {
        try {
          const response = await workspace.chatWithNote(root, { ...input.settings },
            messages.map(({ role, content }) => ({ role, content })), requestTarget, (progress) => {
              if (!isCurrent()) return;
              const previous = task.activity[task.activity.length - 1]?.progress;
              const changed = previous?.stage !== progress.stage || previous?.tool !== progress.tool || previous?.query !== progress.query;
              task = {
                ...task, progress,
                raw: progress.stage === "callingTool" || progress.stage === "generating" ? "" : task.raw + (progress.contentDelta ?? ""),
                reasoning: task.reasoning + (progress.reasoningDelta ?? ""),
                activity: changed ? [...task.activity, {
                  progress: { ...progress, contentDelta: undefined, reasoningDelta: undefined }, elapsedMs: Date.now() - startedAt,
                }] : task.activity,
              };
              history.updateSession(id, { task });
            });
          if (!isCurrent()) return;
          history.complete(id, [...messages, {
            role: "assistant", content: response.message || input.fallbackReply,
            reasoning: task.reasoning, activity: task.activity, elapsedMs: Date.now() - startedAt,
            citations: selectUsedNoteCitations(response.message || input.fallbackReply, response.citations,
              requestTarget && !response.edit ? { path: requestTarget.path, title: citationTitleFromPath(requestTarget.path) } : null),
          }]);
          history.updateSession(id, {
            task: { ...task, status: "completed", progress: { stage: "completed" }, finishedAt: Date.now(), raw: "" },
            ...(requestTarget && originalTarget && response.edit && response.edit.replacement !== originalTarget.source
              ? { pendingEdit: { ...(edit ?? originalTarget), replacement: response.edit.replacement } } : {}),
          });
        } catch (error) {
          if (!isCurrent()) return;
          history.updateSession(id, { task: {
            ...task, status: "failed", progress: { stage: "failed" }, finishedAt: Date.now(), raw: "",
            error: mapGatewayError(error), activity: [...task.activity, { progress: { stage: "failed" }, elapsedMs: Date.now() - startedAt }],
          } });
        }
      })();
      return id;
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
      if (conversation) history.put({ ...conversation, messages, updatedAt: Date.now() });
    },
    remove(id: string) {
      if (!snapshot.loaded) return;
      const sessions = { ...snapshot.sessions };
      delete sessions[id];
      publish({ ...snapshot, sessions, activeId: snapshot.activeId === id ? null : snapshot.activeId,
        conversations: snapshot.conversations.filter((item) => item.id !== id) });
      void save();
    },
  };
  return history;
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
    history = createAiConversationHistory(persistence, key, getGateways().workspace);
    workspaces.set(key, history);
  }
  const snapshot = useSyncExternalStore(history.subscribe, history.getSnapshot);
  useEffect(() => { if (root) void history.load(); }, [history, root]);
  return { history, ...snapshot };
}
