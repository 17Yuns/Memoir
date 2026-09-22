import * as stylex from "@stylexjs/stylex";
import { Info, Mic, Square, Sparkles, X } from "lucide-react";
import { useCallback, useEffect, useId, useImperativeHandle, useState, useSyncExternalStore, type Ref } from "react";
import { createPortal } from "react-dom";
import { Button, IconButton, SegmentedControl } from "../../components/ui";
import { SpeechSession } from "../../application/speech/speech-session";
import { buildSpeechContext } from "../../application/speech/speech-context";
import type { SpeechTarget } from "../../domain/speech";
import { getGateways } from "../../gateways";
import { useI18n } from "../../i18n/react";
import { messageKeys, type MessageKey } from "../../i18n";
import { useAppStore } from "../../store/app-store";
import { colors } from "../../styles/tokens.stylex";
import { useSpeechPosition, type SpeechAnchor } from "./speech-position";

export type SpeechDialogHandle = { activate: () => void };

export function SpeechDialog({ ref, target, getAnchor, anchorElement, onClose, onInsert }: {
  ref?: Ref<SpeechDialogHandle>;
  target: SpeechTarget;
  getAnchor: () => SpeechAnchor | null;
  anchorElement?: HTMLElement | null;
  onClose: () => void;
  onInsert: (text: string) => boolean;
}) {
  const { t } = useI18n();
  const titleId = useId();
  const privacyId = useId();
  const [showPrivacy, setShowPrivacy] = useState(false);
  const { panelRef, position } = useSpeechPosition(getAnchor, anchorElement);
  const [session] = useState(() => new SpeechSession(getGateways().speech, useAppStore.getState().settings.speech.model));
  const state = useSyncExternalStore(session.subscribe, session.snapshot);
  const ai = useAppStore((store) => store.settings.ai);
  const activePath = useAppStore((store) => store.activePath);
  const root = useAppStore((store) => store.workspaceRoot);
  const content = useAppStore((store) => store.content);
  const viewMode = useAppStore((store) => store.viewMode);
  const [options] = useState(() => ({ ...useAppStore.getState().settings.speech, ai, context: buildSpeechContext(target) }));
  const [insertError, setInsertError] = useState(false);
  const busy = !["idle", "ready"].includes(state.phase);
  const targetChanged = activePath !== target.path || root !== target.root || content !== target.content || viewMode === "preview";
  const close = useCallback(() => { session.dispose(); onClose(); }, [session, onClose]);
  useEffect(() => { void session.initialize(options); return () => session.dispose(); }, [session, options]);
  const error = state.error && messageKeys.includes(state.error as MessageKey) ? state.error as MessageKey : "speech.operationError";
  const ready = state.model?.ready;
  useImperativeHandle(ref, () => ({
    activate: () => {
      if (state.phase === "recording") void session.stop();
      else if (state.phase === "idle" && ready && !targetChanged) void session.start(options);
      else if (state.phase === "ready") panelRef.current?.querySelector("textarea")?.focus();
    },
  }), [state.phase, session, ready, targetChanged, options, panelRef]);

  return createPortal(
    <div ref={panelRef} role="dialog" aria-modal={false} aria-labelledby={titleId}
      {...stylex.props(styles.panel, Boolean(state.transcript) && styles.expanded, styles.position(position.left, position.top))}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !event.nativeEvent.isComposing) {
          event.preventDefault();
          event.stopPropagation();
          close();
          anchorElement?.querySelector<HTMLElement>(".cm-content")?.focus();
        }
      }}
    >
      <header {...stylex.props(styles.header)}>
        <Mic size={14} {...stylex.props(state.phase === "recording" && styles.recordingIcon)} />
        <h2 id={titleId} {...stylex.props(styles.title)}>{t("speech.title")}</h2>
        <IconButton label={t("speech.privacy")} aria-expanded={showPrivacy} aria-controls={privacyId}
          onClick={() => setShowPrivacy((value) => !value)} style={styles.iconButton}><Info size={14} /></IconButton>
        <IconButton label={t("common.close")} onClick={close} style={styles.iconButton}><X size={14} /></IconButton>
      </header>
      <div {...stylex.props(styles.body)}>
        {showPrivacy && <p id={privacyId} {...stylex.props(styles.hint)}>{t("speech.privacy")}</p>}
        <div {...stylex.props(styles.statusRow)}>
          <span aria-hidden="true" {...stylex.props(styles.statusDot, state.phase === "recording" && styles.recordingDot)} />
          <span role="status" aria-live="polite" {...stylex.props(styles.status)}>
            {state.phase === "recording" ? t("speech.recording", { seconds: state.seconds }) :
              busy ? t(`speech.${state.phase}` as MessageKey, { progress: state.progress }) : t(state.transcript ? "speech.result" : "speech.limit")}
          </span>
          {state.phase === "recording" && <Button size="sm" variant="danger" onClick={() => void session.stop()}><Square size={12} />{t("speech.stop")}</Button>}
          {busy && state.phase !== "checking" && state.phase !== "recording" &&
            <Button size="sm" variant="ghost" onClick={() => session.cancel()}>{t("common.cancel")}</Button>}
        </div>
        {state.phase === "idle" && state.model && !ready && <>
          <p {...stylex.props(styles.hint)}>{t("speech.setupRequired")}</p>
          <Button onClick={() => { close(); useAppStore.getState().openSettings("speech"); }}>{t("speech.openSettings")}</Button>
        </>}
        {!busy && ready && !state.transcript && <Button size="sm" variant="primary" disabled={!session.gateway.available || targetChanged}
          onClick={() => { setInsertError(false); void session.start(options); }}><Mic size={14} />{t("speech.start")}</Button>}
        {(state.phase === "downloading" || state.phase === "transcribing") &&
          <progress aria-label={t(`speech.${state.phase}` as MessageKey, { progress: state.progress })} max={100} value={state.progress} {...stylex.props(styles.progress)} />}
        {state.error && <p role="alert" {...stylex.props(styles.error)}>{t(error)}</p>}
        {(targetChanged || insertError) && <p role="alert" {...stylex.props(styles.error)}>{t("speech.targetChanged")}</p>}
        {state.transcript && <>
          {state.formatted && <SegmentedControl label={t("speech.result")} value={state.variant} onChange={(value) => session.select(value)} options={[
            { value: "original", label: t("speech.original") }, { value: "formatted", label: t("speech.formatted") },
          ]} />}
          <textarea aria-label={t("speech.result")} value={state.draft} readOnly={state.phase !== "ready"}
            onChange={(event) => session.edit(event.target.value)} {...stylex.props(styles.transcript)} />
          <p {...stylex.props(styles.hint)}>{t("speech.review")}</p>
        </>}
      </div>
      {state.transcript && <footer {...stylex.props(styles.actions)}>
        <Button size="sm" variant="ghost" disabled={busy || targetChanged}
          onClick={() => { setInsertError(false); void session.start(options); }}><Mic size={13} />{t("speech.recordAgain")}</Button>
        {ai.enabled && <Button size="sm" variant="ghost" disabled={busy} onClick={() => void session.format(ai)}><Sparkles size={13} />{t("speech.format")}</Button>}
        <Button size="sm" variant="primary" disabled={state.phase !== "ready" || !state.draft.trim() || targetChanged}
          onClick={() => { if (onInsert(state.draft)) close(); else setInsertError(true); }}>{t("speech.insert")}</Button>
      </footer>}
    </div>,
    document.body,
  );
}

const styles = stylex.create({
  panel: { position: "fixed", zIndex: 40, width: 320, maxWidth: "calc(100vw - 24px)", maxHeight: "calc(100dvh - 24px)",
    overflow: "auto", borderRadius: 12, borderWidth: 1, borderStyle: "solid", borderColor: colors.border,
    backgroundColor: colors.elevated, color: colors.text,
    boxShadow: "0 8px 28px rgb(0 0 0 / 12%), 0 2px 6px rgb(0 0 0 / 6%)" },
  expanded: { width: 360 },
  position: (left: number, top: number) => ({ left, top }),
  header: { display: "flex", alignItems: "center", gap: 7, padding: "8px 10px 0 14px" },
  title: { margin: 0, marginRight: "auto", fontSize: 12, fontWeight: 650 },
  iconButton: { width: 24, height: 24, flexShrink: 0 },
  body: { display: "flex", flexDirection: "column", gap: 10, padding: "10px 14px 14px" },
  statusRow: { display: "flex", alignItems: "center", gap: 8 },
  status: { flex: 1, fontSize: 11, lineHeight: 1.6, color: colors.muted, fontVariantNumeric: "tabular-nums" },
  statusDot: { width: 6, height: 6, flexShrink: 0, borderRadius: "50%", backgroundColor: colors.muted },
  recordingDot: { backgroundColor: colors.danger, boxShadow: `0 0 0 3px color-mix(in srgb, ${colors.danger} 12%, transparent)` },
  recordingIcon: { color: colors.danger },
  hint: { margin: 0, fontSize: 12, lineHeight: 1.7, color: colors.muted },
  actions: { display: "flex", alignItems: "center", justifyContent: "flex-end", flexWrap: "wrap", gap: 6,
    padding: "10px 12px", borderTopWidth: 1, borderTopStyle: "solid", borderTopColor: colors.border },
  error: { color: colors.danger, margin: 0, fontSize: 12, lineHeight: 1.7 },
  progress: { width: "100%", height: 6 },
  transcript: { width: "100%", height: 144, minHeight: 80, maxHeight: "35vh", resize: "vertical", padding: 10, borderRadius: 8,
    borderWidth: 1, borderStyle: "solid", borderColor: colors.border, backgroundColor: colors.panel, color: colors.text, fontSize: 13, lineHeight: 1.8 },
});
