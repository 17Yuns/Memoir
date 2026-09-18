import * as stylex from "@stylexjs/stylex";
import { useMemo, useState } from "react";
import { Collapsible, Tag } from "../../components/ui";
import { parseNoteProperties, type NoteProperty } from "../../domain/notes/note-utils";
import { useI18n } from "../../i18n/react";
import { colors } from "../../styles/tokens.stylex";
import { notePropertyInput, updateNoteProperty } from "./note-properties";

export function NoteProperties({
  content,
  fallbackTitle,
  fallbackTags,
  onContentChange,
}: {
  content: string;
  fallbackTitle: string;
  fallbackTags?: string[];
  onContentChange?: (content: string) => void;
}) {
  const { t } = useI18n();
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [initialDraft, setInitialDraft] = useState("");
  const [error, setError] = useState(false);
  const properties = useMemo(() => {
    const parsed = parseNoteProperties(content, fallbackTitle);
    if (parsed.some((property) => property.key === "tags") || !fallbackTags?.length) return parsed;
    return [parsed[0], { key: "tags", values: fallbackTags, kind: "list" as const }, ...parsed.slice(1)];
  }, [content, fallbackTags, fallbackTitle]);
  const labels: Record<string, string> = {
    title: t("properties.title"),
    tags: t("properties.tags"),
    aliases: t("properties.aliases"),
  };

  function startEditing(property: NoteProperty) {
    const value = notePropertyInput(content, property.key, property.values.join(", "));
    setDraft(value);
    setInitialDraft(value);
    setError(false);
    setEditing(property.key);
  }

  function commit() {
    if (!editing || !onContentChange) return;
    if (draft !== initialDraft) {
      try {
        onContentChange(updateNoteProperty(content, editing, draft));
      } catch {
        setError(true);
        return;
      }
    }
    setEditing(null);
    setError(false);
  }

  return (
    <Collapsible aria-label={t("properties.label")} label={t("properties.label")} style={styles.properties}>
      <div data-note-properties="">
        {properties.map((property) => {
          const label = labels[property.key] || property.key;
          const value = property.kind === "list"
            ? property.values.map((item, index) => <Tag key={`${index}-${item}`}>{item}</Tag>)
            : property.values[0];
          return (
            <div data-property-key={property.key} {...stylex.props(styles.row)} key={property.key}>
              <span {...stylex.props(styles.key)}>{label}</span>
              {editing === property.key ? (
                <div {...stylex.props(styles.editor)}>
                  <input
                    aria-label={label}
                    aria-invalid={error || undefined}
                    autoFocus
                    value={draft}
                    placeholder={property.kind === "list" ? t("properties.listHint") : undefined}
                    title={t("properties.editHint")}
                    onChange={(event) => {
                      setDraft(event.target.value);
                      setError(false);
                    }}
                    onBlur={commit}
                    onKeyDown={(event) => {
                      event.stopPropagation();
                      if (event.nativeEvent.isComposing) return;
                      if (event.key === "Enter") {
                        event.preventDefault();
                        commit();
                      }
                      if (event.key === "Escape") {
                        event.preventDefault();
                        setEditing(null);
                        setError(false);
                      }
                    }}
                    {...stylex.props(styles.control, styles.input, error && styles.invalidInput)}
                  />
                  {error && <span role="alert" {...stylex.props(styles.error)}>{t("properties.invalid")}</span>}
                </div>
              ) : onContentChange ? (
                <button
                  type="button"
                  aria-label={t("properties.edit", { name: label })}
                  title={t("properties.edit", { name: label })}
                  onClick={() => startEditing(property)}
                  {...stylex.props(styles.value, styles.control, styles.button, property.kind === "list" && styles.list)}
                >
                  {property.values.length ? value : <span {...stylex.props(styles.empty)}>{t("properties.empty")}</span>}
                </button>
              ) : (
                <div {...stylex.props(styles.value, property.kind === "list" && styles.list)}>{value}</div>
              )}
            </div>
          );
        })}
      </div>
    </Collapsible>
  );
}

const styles = stylex.create({
  properties: { marginBottom: 24 },
  row: {
    display: "grid",
    gridTemplateColumns: "minmax(72px, 24%) minmax(0, 1fr)",
    gap: 12,
    minHeight: 44,
    alignItems: "center",
    paddingBlock: 8,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: colors.border,
    ":last-child": { borderBottomWidth: 0 },
  },
  key: { color: colors.muted, fontSize: 14, overflowWrap: "anywhere" },
  value: { minWidth: 0, color: colors.text, fontSize: 14, overflowWrap: "anywhere" },
  list: { display: "flex", flexWrap: "wrap", gap: 6 },
  control: {
    width: "100%",
    minWidth: 0,
    minHeight: 32,
    boxSizing: "border-box",
    margin: 0,
    paddingBlock: 5,
    paddingInline: 8,
    borderWidth: 0,
    borderRadius: 5,
    color: colors.text,
    textAlign: "start",
    fontFamily: "inherit",
    fontSize: 14,
    lineHeight: "22px",
    // Override the global focus ring; each control supplies a subtle inset indicator.
    outline: { default: "none", ":focus-visible": "none" },
  },
  button: {
    backgroundColor: {
      default: "transparent",
      ":hover": colors.canvas,
      ":focus-visible": colors.canvas,
    },
    boxShadow: {
      default: "none",
      ":focus-visible": `inset 0 0 0 1px color-mix(in srgb, ${colors.muted} 30%, ${colors.border})`,
    },
    cursor: "text",
  },
  editor: { minWidth: 0 },
  input: {
    appearance: "none",
    backgroundColor: colors.canvas,
    boxShadow: {
      default: `inset 0 0 0 1px ${colors.border}`,
      ":focus": `inset 0 0 0 1px color-mix(in srgb, ${colors.muted} 30%, ${colors.border})`,
    },
  },
  invalidInput: {
    boxShadow: {
      default: `inset 0 0 0 1px ${colors.danger}`,
      ":focus": `inset 0 0 0 1px ${colors.danger}`,
    },
  },
  empty: { color: colors.muted },
  error: { color: colors.danger, fontSize: 12 },
});
