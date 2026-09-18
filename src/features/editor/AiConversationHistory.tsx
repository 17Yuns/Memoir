import * as stylex from "@stylexjs/stylex";
import { LoaderCircle, MessageSquare, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button, IconButton } from "../../components/ui";
import type { AiConversationSession } from "./ai-conversation-history";
import type { AiConversation } from "../../domain/ai";
import { useI18n } from "../../i18n/react";
import { accents, colors } from "../../styles/tokens.stylex";

export function AiConversationHistory({ conversations, activeId, sessions, loading, onOpen, onDelete }: {
  conversations: AiConversation[];
  activeId: string | null;
  sessions: Record<string, AiConversationSession>;
  loading: boolean;
  onOpen: (conversation: AiConversation) => void;
  onDelete: (id: string) => void;
}) {
  const { t, locale } = useI18n();
  const [deletingId, setDeletingId] = useState<string | null>(null);
  return (
    <section aria-label={t("aiRewrite.history")} {...stylex.props(styles.history)}>
      <h3 {...stylex.props(styles.heading)}>{t("aiRewrite.history")}</h3>
      <p {...stylex.props(styles.hint)}>{t("aiRewrite.historyContextHint")}</p>
      {loading ? <p role="status" {...stylex.props(styles.hint)}>{t("aiRewrite.historyLoading")}</p>
        : !conversations.length ? <p {...stylex.props(styles.empty)}>{t("aiRewrite.historyEmpty")}</p>
        : <ul {...stylex.props(styles.list)}>
          {conversations.map((conversation) => (
            <li key={conversation.id} {...stylex.props(styles.item, activeId === conversation.id && styles.active)}>
              <div {...stylex.props(styles.row)}>
                <button type="button" onClick={() => onOpen(conversation)} aria-current={activeId === conversation.id ? "true" : undefined}
                  {...stylex.props(styles.open)}>
                  <span {...stylex.props(styles.title)}><MessageSquare aria-hidden="true" size={13} />{conversation.title}</span>
                  <span {...stylex.props(styles.metadata)}>
                    {sessions[conversation.id]?.task && <span {...stylex.props(styles.taskStatus)}>
                      {sessions[conversation.id].task?.status === "running" && <LoaderCircle size={11} {...stylex.props(styles.spinner)} />}
                      {t(sessions[conversation.id].task?.status === "running" ? "aiRewrite.generating"
                        : sessions[conversation.id].task?.status === "failed" ? "aiRewrite.failed" : "aiRewrite.completed")}
                    </span>}
                    {conversation.notePath && <span title={conversation.notePath} {...stylex.props(styles.path)}>{conversation.notePath}</span>}
                    <time dateTime={new Date(conversation.updatedAt).toISOString()}>
                      {new Date(conversation.updatedAt).toLocaleString(locale === "zh" ? "zh-CN" : "en-US", {
                        month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
                      })}
                    </time>
                  </span>
                </button>
                <IconButton label={t("aiRewrite.deleteConversation", { title: conversation.title })}
                  onClick={() => setDeletingId(conversation.id)}>
                  <Trash2 size={13} />
                </IconButton>
              </div>
              {deletingId === conversation.id && <div {...stylex.props(styles.confirm)}>
                <p {...stylex.props(styles.hint)}>{t("aiRewrite.deleteConversationHint")}</p>
                <Button size="sm" onClick={() => setDeletingId(null)}>{t("common.cancel")}</Button>
                <Button size="sm" variant="danger" onClick={() => { onDelete(conversation.id); setDeletingId(null); }}>
                  {t("aiRewrite.confirmDeleteConversation")}
                </Button>
              </div>}
            </li>
          ))}
        </ul>}
    </section>
  );
}

const spin = stylex.keyframes({ to: { transform: "rotate(360deg)" } });

const styles = stylex.create({
  taskStatus: { display: "inline-flex", alignItems: "center", gap: "4px", color: accents.primary },
  spinner: { animationName: spin, animationDuration: "900ms", animationIterationCount: "infinite", animationTimingFunction: "linear" },
  history: { minHeight: 0, overflowY: "auto", padding: "14px" },
  heading: { margin: "0 0 8px", color: colors.text, fontSize: "13px", fontWeight: 650 },
  hint: { margin: "0 0 10px", color: colors.muted, fontSize: "11px", lineHeight: 1.6 },
  empty: { padding: "32px 0", color: colors.muted, fontSize: "12px", textAlign: "center" },
  list: { display: "grid", gap: "8px", margin: 0, padding: 0, listStyle: "none" },
  item: { minWidth: 0, borderWidth: "1px", borderStyle: "solid", borderColor: colors.border, borderRadius: "8px", padding: "5px" },
  active: { borderColor: accents.primary, backgroundColor: `color-mix(in srgb, ${accents.primary} 5%, ${colors.panel})` },
  row: { display: "flex", alignItems: "center", gap: "4px" },
  open: {
    flex: 1, minWidth: 0, display: "grid", gap: "7px", padding: "7px", borderWidth: 0,
    borderRadius: "5px", backgroundColor: { default: "transparent", ":hover": colors.elevated },
    color: colors.text, fontFamily: "inherit", textAlign: "left", cursor: "pointer",
  },
  title: { display: "flex", alignItems: "baseline", gap: "6px", overflowWrap: "anywhere", fontSize: "12px", lineHeight: 1.5 },
  metadata: { display: "flex", flexWrap: "wrap", gap: "4px 10px", color: colors.muted, fontSize: "10px" },
  path: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "100%" },
  confirm: { padding: "8px", borderTopWidth: "1px", borderTopStyle: "solid", borderTopColor: colors.border },
});
