import type { AppSettings } from "./settings";

export type AiRewriteScope = "selection" | "document";
export type AiSettings = AppSettings["ai"];

export type AiChatMessage = {
  role: "user" | "assistant";
  content: string;
};

export type AiRewriteTarget = {
  path: string;
  from: number;
  to: number;
  source: string;
  scope: AiRewriteScope;
};

export type AiEditProposal = {
  tool: "replace_selection" | "replace_document";
  replacement: string;
};

export type AiNoteCitation = {
  path: string;
  title: string;
};

export type AiChatResponse = {
  message: string;
  edit: AiEditProposal | null;
  citations?: AiNoteCitation[];
};

export function citationTitleFromPath(path: string): string {
  const file = path.split(/[\\/]/).pop() || path;
  return file.replace(/\.(mdx|md)$/i, "") || path;
}

export function formatNoteCitation(citation: AiNoteCitation): string {
  const stem = citationTitleFromPath(citation.path);
  if (citation.title && citation.title !== stem && citation.title !== citation.path) {
    return `${citation.title} · ${citation.path}`;
  }
  return citation.path;
}

export function mergeNoteCitations(
  ...groups: Array<Iterable<AiNoteCitation> | null | undefined>
): AiNoteCitation[] {
  const seen = new Set<string>();
  const merged: AiNoteCitation[] = [];
  for (const group of groups) {
    if (!group) continue;
    for (const item of group) {
      const path = item.path.trim();
      if (!path || seen.has(path)) continue;
      seen.add(path);
      merged.push({
        path,
        title: item.title.trim() || citationTitleFromPath(path),
      });
    }
  }
  return merged;
}

function citationFileName(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

function messageIncludesToken(message: string, token: string): boolean {
  const trimmed = token.trim();
  if (!trimmed) return false;
  const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^\\w./\\\\-])${escaped}([^\\w./\\\\-]|$)`).test(message);
}

export function messageMentionsCitation(message: string, citation: AiNoteCitation): boolean {
  const path = citation.path.replaceAll("\\", "/");
  return messageIncludesToken(message, path) || messageIncludesToken(message, citationFileName(path));
}

/** Keep notes the reply actually named. Unused search hits are dropped. */
export function selectUsedNoteCitations(
  message: string,
  retrieved: Iterable<AiNoteCitation> | null | undefined,
  fallback?: AiNoteCitation | null,
): AiNoteCitation[] {
  const retrievedNotes = mergeNoteCitations(retrieved);
  const candidates = mergeNoteCitations(retrievedNotes, fallback ? [fallback] : []);
  const mentioned = candidates.filter((citation) => messageMentionsCitation(message, citation));
  if (mentioned.length) return mentioned;
  if (retrievedNotes.length) return [];
  return fallback ? mergeNoteCitations([fallback]) : [];
}

export const AI_CHAT_PROGRESS_EVENT = "ai-chat-progress";

export type AiChatProgress = {
  stage:
    | "preparing"
    | "callingModel"
    | "callingTool"
    | "toolCompleted"
    | "generating"
    | "reasoning"
    | "receiving"
    | "preparingTool"
    | "validating"
    | "completed"
    | "failed";
  requestId?: string;
  contentDelta?: string;
  reasoningDelta?: string;
  model?: string;
  tool?: string;
  query?: string;
  resultCount?: number;
};

export type AiEditorEdit = AiRewriteTarget & {
  replacement: string;
};
