import * as stylex from "@stylexjs/stylex";
import { Check, Link2, RefreshCw } from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type RefObject } from "react";
import { EchoSession } from "../../application/echo-session";
import { Button, Dialog, IconButton } from "../../components/ui";
import { extractNoteLinks, resolveNoteRef } from "../../domain/note-links";
import { buildExcerpt, parseNote } from "../../domain/notes/note-utils";
import type { SemanticSearchResult, VectorIndexStatus } from "../../domain/vector-index";
import { wikiInsertToken } from "../../domain/wiki-link";
import { getGateways } from "../../gateways";
import { useI18n } from "../../i18n/react";
import { useAppStore } from "../../store/app-store";
import { colors } from "../../styles/tokens.stylex";
import type { EditorHandle } from "../editor/EditorPane";
import { useNoteGraph } from "../graph/useNoteGraph";
import type { EchoContext } from "./editor-context";

type PreviewTarget = { root: string; source: EchoContext; note: SemanticSearchResult };
const NotePreviewArticle = lazy(() => import("../preview/NotePreviewArticle").then((module) => ({ default: module.NotePreviewArticle })));

export function EchoPanel({ session, editorRef }: { session: EchoSession; editorRef: RefObject<EditorHandle | null> }) {
  const { t } = useI18n();
  const root = useAppStore((s) => s.workspaceRoot);
  const path = useAppStore((s) => s.activePath);
  const loadedPath = useAppStore((s) => s.loadedContentPath);
  const loading = useAppStore((s) => s.isLoading);
  const mode = useAppStore((s) => s.viewMode);
  const ai = useAppStore((s) => s.settings.ai);
  const collapsed = useAppStore((s) => s.layout.libraryCollapsed);
  const mobilePanel = useAppStore((s) => s.mobilePanel);
  const openSettings = useAppStore((s) => s.openSettings);
  const setPanel = useAppStore((s) => s.setLibraryPanelMode);
  const { graph } = useNoteGraph();
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const [visible, setVisible] = useState(!document.hidden);
  const [mobile, setMobile] = useState(() => window.matchMedia("(max-width: 760px)").matches);
  const [status, setStatus] = useState<{ key: string; value: VectorIndexStatus } | null>(null);
  const [statusError, setStatusError] = useState(false);
  const [reload, setReload] = useState(0);
  const [preview, setPreview] = useState<PreviewTarget | null>(null);
  const [insertError, setInsertError] = useState(false);
  const [inserting, setInserting] = useState(false);
  const [readError, setReadError] = useState(false);
  const [unreadable, setUnreadable] = useState<Set<string>>(() => new Set());
  const alive = useRef(true);
  const configKey = JSON.stringify([root, ai]);
  const vector = status?.key === configKey ? status.value : null;
  const shown = visible && (mobile ? mobilePanel === "library" : !collapsed);
  const editable = Boolean(root && path && path === loadedPath && !loading && mode !== "preview");
  const configured = ai.enabled && Boolean(ai.embeddingModel.trim() && ai.baseUrl.trim());
  const available = configured && vector?.enabled && vector.model === ai.embeddingModel.trim() && vector.indexedNotes > 0 && vector.chunkCount > 0;
  const liveDoc = state.context?.sourcePath === path ? state.context.doc : null;
  const title = useMemo(() => liveDoc ? parseNote(liveDoc.toString(), path ?? "").title : path ?? "", [liveDoc, path]);

  useEffect(() => {
    setUnreadable(new Set());
    setReadError(false);
    setInsertError(false);
  }, [path, root]);

  useEffect(() => {
    alive.current = true;
    const visibility = () => setVisible(!document.hidden);
    const media = window.matchMedia("(max-width: 760px)");
    const resize = () => setMobile(media.matches);
    document.addEventListener("visibilitychange", visibility);
    media.addEventListener("change", resize);
    return () => {
      alive.current = false;
      session.pause();
      document.removeEventListener("visibilitychange", visibility);
      media.removeEventListener("change", resize);
    };
  }, [session]);

  // Status checks are local reads; never start indexing or call an embedding service.
  useEffect(() => {
    if (!root || !configured || !shown || preview || !editable) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const check = async () => {
      try {
        const value = await getGateways().workspace.getVectorIndexStatus(root, ai);
        if (cancelled) return;
        setStatus((previous) => previous?.key === configKey && JSON.stringify(previous.value) === JSON.stringify(value)
          ? previous : { key: configKey, value });
        setStatusError(false);
        timer = setTimeout(() => void check(), 10000);
      } catch {
        if (!cancelled) { setStatusError(true); setStatus(null); }
      }
    };
    void check();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [ai, configKey, configured, editable, preview, reload, root, shown]);

  useLayoutEffect(() => {
    session.configure({ root: root ?? "", path: path ?? "", title, settings: ai,
      indexKey: vector ? JSON.stringify(vector) : "",
      enabled: Boolean(shown && editable && available && !preview),
    });
  }, [ai, available, editable, path, preview, root, session, shown, title, vector]);

  const outgoing = useMemo(() => new Set(liveDoc
    ? extractNoteLinks(liveDoc.toString()).map((link) => resolveNoteRef(link.targetRef, path ?? "", graph.nodes))
    : []), [graph.nodes, path, liveDoc]);

  const restore = useCallback((source: EchoContext, sourceRoot: string) => {
    requestAnimationFrame(() => {
      const current = useAppStore.getState();
      if (current.workspaceRoot === sourceRoot && current.activePath === source.sourcePath && current.loadedContentPath === source.sourcePath) {
        editorRef.current?.restoreEcho(source);
      }
    });
  }, [editorRef]);
  const closePreview = useCallback(() => {
    if (preview) restore(preview.source, preview.root);
    setPreview(null);
    setInsertError(false);
  }, [preview, restore]);

  const insert = async (note: SemanticSearchResult, source = editorRef.current?.captureEcho(), sourceRoot = root) => {
    if (!source || !sourceRoot || inserting) return;
    setInserting(true);
    setInsertError(false);
    setReadError(false);
    try {
      // Validate existence even for direct card insertion and deletion after preview opened.
      await getGateways().workspace.readNote(sourceRoot, note.relativePath);
      if (!alive.current) return;
      const current = useAppStore.getState();
      const catalog = graph.nodes;
      const referenced = extractNoteLinks(editorRef.current?.captureEcho()?.doc.toString() ?? "")
        .some((link) => resolveNoteRef(link.targetRef, source.sourcePath, catalog) === note.relativePath);
      if (referenced) return;
      const token = wikiInsertToken(note, catalog, "", false, source.sourcePath);
      const link = `[[${token}]]`;
      const parsedLink = extractNoteLinks(link)[0];
      if (current.workspaceRoot !== sourceRoot || current.activePath !== source.sourcePath || current.loadedContentPath !== source.sourcePath ||
          current.viewMode === "preview" || current.isLoading || note.relativePath === source.sourcePath ||
          !parsedLink || resolveNoteRef(parsedLink.targetRef, source.sourcePath, catalog) !== note.relativePath || !editorRef.current?.insertEcho(source, link)) {
        setInsertError(true);
        return;
      }
      setPreview(null);
      const after = editorRef.current?.captureEcho();
      if (after) restore(after, sourceRoot);
    } catch {
      if (alive.current) { setReadError(true); setUnreadable((previous) => new Set([...previous, note.relativePath])); }
    }
    finally { if (alive.current) setInserting(false); }
  };

  const retry = () => { setUnreadable(new Set()); setReadError(false); setReload((value) => value + 1); session.refresh(); };
  return (
    <section aria-label={t("echo.title")} {...stylex.props(styles.section)}>
      <div {...stylex.props(styles.heading)}>
        <h3 title={t("echo.description")} {...stylex.props(styles.title)}>{t("echo.title")}</h3>
        <span {...stylex.props(styles.context)}>{t(state.context?.kind === "selection" ? "echo.selection" : "echo.paragraph")}</span>
        <span role="status" {...stylex.props(styles.update)}>{state.loading ? t("echo.updating") : ""}</span>
        <IconButton style={styles.iconButton} label={t("echo.refresh")} onClick={retry} disabled={!editable || !shown || Boolean(preview) || !configured}>
          <RefreshCw size={13} />
        </IconButton>
      </div>
      {!state.results.length && <p {...stylex.props(styles.hint)}>{t("echo.description")}</p>}
      {!configured ? <><p {...stylex.props(styles.hint)}>{t("echo.configure")}</p><Button size="sm" onClick={() => openSettings("ai")}>{t("echo.settings")}</Button></>
        : statusError ? <p role="alert">{t("echo.failed")} <Button size="sm" onClick={retry}>{t("echo.retry")}</Button></p>
        : vector && !available ? <><p {...stylex.props(styles.hint)}>{t(vector.model !== ai.embeddingModel.trim() ? "echo.mismatch" : "echo.noIndex")}</p><Button size="sm" onClick={() => setPanel("index")}>{t("echo.index")}</Button></>
        : <>
          {vector && vector.indexedNotes < vector.totalNotes && <p {...stylex.props(styles.hint)}>{t("echo.partial", { count: vector.indexedNotes, total: vector.totalNotes })}</p>}
          {(!editable || !state.context?.text) && <p {...stylex.props(styles.hint)}>{t("echo.emptyContext")}</p>}
          {state.error && <p role="alert">{t("echo.failed")} <Button size="sm" onClick={retry}>{t("echo.retry")}</Button></p>}
          {state.results.length > 0 && <ul aria-label={t("echo.candidates")} {...stylex.props(styles.list)}>
          {state.results.map((note) => <li key={note.relativePath} {...stylex.props(styles.card)}>
            <button type="button" {...stylex.props(styles.read)} onClick={() => {
              const source = editorRef.current?.captureEcho();
              if (source && root) { setInsertError(false); setReadError(false); setPreview({ root, source, note }); }
            }}>
              <strong title={note.title} {...stylex.props(styles.noteTitle)}>{note.title}</strong>
              <span title={note.relativePath} {...stylex.props(styles.path)}>{note.relativePath}</span>
              <span {...stylex.props(styles.snippet)}>{buildExcerpt(note.content)}</span>
            </button>
            <IconButton style={styles.iconButton} label={t(outgoing.has(note.relativePath) ? "echo.referenced" : "echo.insert")}
              disabled={!editable || inserting || unreadable.has(note.relativePath) || outgoing.has(note.relativePath)} onClick={() => void insert(note)}>
              {outgoing.has(note.relativePath) ? <Check size={14} /> : <Link2 size={14} />}
            </IconButton>
          </li>)}
          </ul>}
          {!state.loading && state.context?.text && !state.error && available && !state.results.length && <p {...stylex.props(styles.hint)}>{t("echo.noResults")}</p>}
        </>}
      {(insertError || readError) && !preview && <p role="alert">{t(readError ? "echo.readFailed" : "echo.stale")}</p>}
      {preview && <EchoPreview target={preview} onClose={closePreview} onInsert={insert}
        referenced={outgoing} inserting={inserting} insertError={insertError} readError={readError}
        disabled={!editable || root !== preview.root || path !== preview.source.sourcePath} />}
    </section>
  );
}

function EchoPreview({ target, onClose, onInsert, referenced, inserting, insertError, readError, disabled }: {
  target: PreviewTarget;
  onClose: () => void;
  onInsert: (note: SemanticSearchResult, source: EchoContext, root: string) => Promise<void>;
  referenced: Set<string | undefined>;
  inserting: boolean;
  insertError: boolean;
  readError: boolean;
  disabled: boolean;
}) {
  const { t } = useI18n();
  const [path, setPath] = useState(target.note.relativePath);
  const [loaded, setLoaded] = useState<{ path: string; content: string } | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    setLoaded(null);
    void getGateways().workspace.readNote(target.root, path).then((content) => {
      if (!cancelled) setLoaded({ path, content });
    }).catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [path, target.root]);
  const content = loaded?.path === path ? loaded.content : null;
  const parsed = parseNote(content ?? "", path.split("/").pop() ?? path);
  const current = { ...target.note, relativePath: path, title: parsed.title };
  const already = referenced.has(path) || path === target.source.sourcePath;
  return <Dialog open title={parsed.title} description={path} onClose={onClose} style={styles.dialog} bodyStyle={styles.body}
    footer={<Button variant="primary" disabled={disabled || failed || readError || insertError || content === null || already || inserting}
      onClick={() => void onInsert(current, target.source, target.root)}>{t(already ? "echo.referenced" : "echo.insert")}</Button>}>
    {path !== target.note.relativePath && <Button size="sm" onClick={() => setPath(target.note.relativePath)}>{t("echo.back")}</Button>}
    {path === target.note.relativePath && <blockquote {...stylex.props(styles.match)}>{target.note.content}</blockquote>}
    {(failed || readError) ? <p role="alert">{t("echo.readFailed")}</p> : content === null ? <p role="status">{t("echo.loading")}</p>
      : <Suspense fallback={<p role="status">{t("echo.loading")}</p>}><NotePreviewArticle key={path} root={target.root} relativePath={path} content={content} onOpenNote={setPath} compileDelay={0}
        note={{ relativePath: path, fileName: path.split("/").pop() ?? path, extension: path.endsWith(".mdx") ? "mdx" : "md",
          modifiedMs: 0, size: content.length, title: parsed.title, tags: parsed.tags, excerpt: parsed.excerpt, favorite: false }} /></Suspense>}
    {insertError && <p role="alert">{t("echo.stale")}</p>}
  </Dialog>;
}

const styles = stylex.create({
  section: { display: "grid", alignContent: "start", flexShrink: 0, minWidth: 0, gap: 6, marginBottom: 12, paddingBottom: 12, borderBottomWidth: 1, borderBottomStyle: "solid", borderBottomColor: colors.border },
  heading: { display: "flex", alignItems: "center", gap: 6, minWidth: 0 },
  title: { margin: 0, fontSize: 12, lineHeight: "20px", fontWeight: 600, color: colors.text },
  context: { paddingBlock: 2, paddingInline: 6, borderRadius: 4, backgroundColor: colors.panel, fontSize: 10, lineHeight: "16px", color: colors.muted, whiteSpace: "nowrap" },
  update: { marginLeft: "auto", fontSize: 10, color: colors.muted, whiteSpace: "nowrap" },
  hint: { margin: 0, fontSize: 11, lineHeight: 1.6, color: colors.muted },
  list: { display: "grid", gap: 6, listStyle: "none", padding: 0, margin: 0, minWidth: 0 },
  card: { display: "grid", gridTemplateColumns: "minmax(0, 1fr) 26px", alignItems: "start", gap: 4, padding: 8, borderRadius: 8,
    borderWidth: 1, borderStyle: "solid", borderColor: `color-mix(in srgb, ${colors.border} 65%, transparent)`,
    backgroundColor: { default: `color-mix(in srgb, ${colors.elevated} 45%, transparent)`, ":hover": colors.elevated, ":focus-within": colors.elevated } },
  iconButton: { width: 26, height: 26, minWidth: 26, padding: 0, borderRadius: 6, color: colors.muted },
  read: { display: "grid", gap: 2, minWidth: 0, width: "100%", padding: 0, borderWidth: 0, borderRadius: 3, textAlign: "start", backgroundColor: "transparent", color: colors.text, cursor: "pointer", fontSize: 12 },
  noteTitle: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 600, lineHeight: "18px" },
  path: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 10, lineHeight: "14px", color: colors.muted },
  snippet: { display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", maxHeight: 32, fontSize: 11, lineHeight: "16px", color: colors.muted, overflowWrap: "anywhere" },
  dialog: { maxWidth: 820, display: "flex", flexDirection: "column", overflow: "hidden" },
  body: { overflowY: "auto", minHeight: 0 },
  match: { margin: 0, padding: 12, borderRadius: 8, backgroundColor: colors.panel, whiteSpace: "pre-wrap", fontSize: 12, color: colors.muted },
});
