import * as stylex from "@stylexjs/stylex";
import { Download, Upload } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { SpeechSession } from "../../application/speech/speech-session";
import { Button, Select, Toggle } from "../../components/ui";
import type { AppSettings } from "../../domain/settings";
import { getGateways } from "../../gateways";
import { messageKeys, type MessageKey } from "../../i18n";
import { useI18n } from "../../i18n/react";
import { colors, commonStyles } from "../../styles/tokens.stylex";
import { settingsStyles as styles } from "./settings-styles.stylex";

export function SpeechSettings({ settings, onChange, onConfigureAi }: {
  settings: AppSettings;
  onChange: (settings: AppSettings) => void;
  onConfigureAi: () => void;
}) {
  const { t } = useI18n();
  const [session] = useState(() => new SpeechSession(getGateways().speech, settings.speech.model));
  const state = useSyncExternalStore(session.subscribe, session.snapshot);
  useEffect(() => { void session.initialize(); return () => session.dispose(); }, [session]);
  const busy = state.phase === "checking" || state.phase === "downloading";
  const update = (patch: Partial<AppSettings["speech"]>) =>
    onChange({ ...settings, speech: { ...settings.speech, ...patch } });
  const error = messageKeys.includes(state.error as MessageKey) ? state.error as MessageKey : "speech.operationError";

  return <div {...stylex.props(commonStyles.fadeIn, styles.section)}>
    <div {...stylex.props(styles.row)} data-settings-row>
      <div {...stylex.props(styles.rowCopy)}>
        <div {...stylex.props(styles.rowLabel)}>{t("speech.model")}</div>
      </div>
      <fieldset disabled={busy} {...stylex.props(styles.rowControl, local.modelSelect)}>
        <Select label={t("speech.model")} value={settings.speech.model} style={styles.select}
          onChange={(model) => { if (!busy) update({ model }); }} options={[
            { value: "base", label: t("speech.modelFast") },
            { value: "small", label: t("speech.modelAccurate") },
          ]} />
      </fieldset>
    </div>
    <div {...stylex.props(local.model)}>
      <strong>{t(state.phase === "checking" ? "speech.checking" : state.model?.ready ? "speech.modelReady" : "speech.modelNeeded")}</strong>
      {state.model && !state.model.ready && <p {...stylex.props(styles.rowDescription)}>{t(settings.speech.model === "base" ? "speech.baseModelHint" : "speech.modelHint")}</p>}
      {!state.model?.ready && <div {...stylex.props(local.actions)}>
        <Button disabled={busy || !session.gateway.available} onClick={() => void session.install()}><Download size={14} />{t("speech.download")}</Button>
        <Button disabled={busy || !session.gateway.available} onClick={() => void session.install(true)}><Upload size={14} />{t("speech.importModel")}</Button>
      </div>}
      {state.phase === "downloading" && <div {...stylex.props(local.download)}>
        <span role="status">{t("speech.downloading", { progress: state.progress })}</span>
        <progress aria-label={t("speech.download")} max={100} value={state.progress} {...stylex.props(local.progress)} />
        <Button onClick={() => session.cancel()}>{t("common.cancel")}</Button>
      </div>}
      {state.error && <p role="alert" {...stylex.props(local.error)}>{t(error)}</p>}
    </div>
    <div {...stylex.props(styles.row)} data-settings-row>
      <div {...stylex.props(styles.rowCopy)}><div {...stylex.props(styles.rowLabel)}>{t("speech.language")}</div></div>
      <div {...stylex.props(styles.rowControl)}>
        <Select label={t("speech.language")} value={settings.speech.language} onChange={(language) => update({ language })} style={styles.select} options={[
          { value: "auto", label: t("speech.autoLanguage") }, { value: "zh", label: "中文" }, { value: "en", label: "English" },
          { value: "ja", label: "日本語" }, { value: "ko", label: "한국어" }, { value: "fr", label: "Français" },
          { value: "de", label: "Deutsch" }, { value: "es", label: "Español" },
        ]} />
      </div>
    </div>
    <div {...stylex.props(styles.row)} data-settings-row>
      <div {...stylex.props(styles.rowCopy)}>
        <div {...stylex.props(styles.rowLabel)}>{t("speech.organize")}</div>
        {!settings.ai.enabled && <Button variant="ghost" onClick={onConfigureAi}>{t("speech.configureAi")}</Button>}
      </div>
      <div {...stylex.props(styles.rowControl)}><Toggle label={t("speech.organize")} checked={settings.speech.organize} onChange={(organize) => update({ organize })} /></div>
    </div>
  </div>;
}

const local = stylex.create({
  modelSelect: { borderWidth: 0, padding: 0, margin: 0, minWidth: 0 },
  model: { padding: 16, borderWidth: 1, borderStyle: "solid", borderColor: colors.border, borderRadius: 10, fontSize: 13 },
  actions: { display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 },
  download: { display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 8, marginTop: 12, color: colors.muted },
  progress: { width: "100%", height: 6 },
  error: { color: colors.danger, fontSize: 12, lineHeight: 1.7 },
});
