import * as stylex from "@stylexjs/stylex";
import { RotateCcw, X } from "lucide-react";
import { useId, useState } from "react";
import { Button, IconButton } from "../../components/ui";
import type { AppSettings } from "../../domain/settings";
import {
  DEFAULT_SHORTCUTS,
  formatShortcut,
  SHORTCUT_ACTIONS,
  type GlobalShortcutAction,
} from "../../domain/shortcuts";
import { useI18n } from "../../i18n/react";
import { detectHostOs } from "../../platform/runtime";
import { shortcutFromEvent } from "../../platform/shortcuts";
import { commonStyles } from "../../styles/tokens.stylex";
import { settingsStyles as styles } from "./settings-styles.stylex";

export function ShortcutSettings({ settings, onChange }: {
  settings: AppSettings;
  onChange: (settings: AppSettings) => void;
}) {
  const { t } = useI18n();
  const hintId = useId();
  const [recording, setRecording] = useState<GlobalShortcutAction | null>(null);
  const [error, setError] = useState<{ action: GlobalShortcutAction; message: string } | null>(null);
  const mac = detectHostOs() === "macos";

  const update = (action: GlobalShortcutAction, binding: string | null) => {
    const conflict = binding && SHORTCUT_ACTIONS.find((other) => {
      if (other === action) return false;
      const existing = settings.shortcuts[other];
      return existing === binding ||
        (other === "zoomIn" && existing === "Mod+Equal" && binding === "Mod+Shift+Equal") ||
        (action === "zoomIn" && binding === "Mod+Equal" && existing === "Mod+Shift+Equal");
    });
    if (conflict) {
      setError({ action, message: t("settings.shortcutConflict", { action: t(`shortcuts.${conflict}`) }) });
      return;
    }
    onChange({ ...settings, shortcuts: { ...settings.shortcuts, [action]: binding } });
    setRecording(null);
    setError(null);
  };

  return (
    <div {...stylex.props(commonStyles.fadeIn, styles.section)}>
      <p {...stylex.props(styles.shortcutHint)} id={hintId}>
        {t("settings.shortcutsHint")}
      </p>
      {SHORTCUT_ACTIONS.map((action) => {
        const label = t(`shortcuts.${action}`);
        const binding = settings.shortcuts[action];
        const active = recording === action;
        return (
          <div {...stylex.props(styles.row)} data-settings-row key={action}>
            <div {...stylex.props(styles.rowCopy)}>
              <div {...stylex.props(styles.rowLabel)}>{label}</div>
              {error?.action === action && (
                <p {...stylex.props(styles.shortcutError)} role="alert">{error.message}</p>
              )}
            </div>
            <div {...stylex.props(styles.shortcutControls)}>
              <Button
                active={active}
                aria-describedby={hintId}
                aria-label={t("settings.shortcutEdit", { action: label })}
                aria-pressed={active}
                data-shortcut-recording={active}
                onBlur={() => setRecording(null)}
                onClick={() => { setRecording(action); setError(null); }}
                onKeyDown={(event) => {
                  if (!active) return;
                  if (event.key === "Tab") return;
                  event.preventDefault();
                  event.stopPropagation();
                  if (event.key === "Escape") {
                    setRecording(null);
                    setError(null);
                    return;
                  }
                  if (event.repeat || event.nativeEvent.isComposing ||
                    ["Control", "Meta", "Alt", "Shift"].includes(event.key)) return;
                  const next = shortcutFromEvent(event.nativeEvent);
                  if (!next) {
                    setError({ action, message: t("settings.shortcutInvalid") });
                    return;
                  }
                  update(action, next);
                }}
                style={[styles.shortcutBinding, active && styles.shortcutRecording]}
              >
                {active ? t("settings.shortcutRecording") : binding ? formatShortcut(binding, mac) : t("settings.shortcutDisabled")}
              </Button>
              <IconButton
                disabled={binding === null}
                label={t("settings.shortcutDisable", { action: label })}
                onClick={() => update(action, null)}
              >
                <X {...stylex.props(styles.smallIcon)} />
              </IconButton>
              <IconButton
                disabled={binding === DEFAULT_SHORTCUTS[action]}
                label={t("settings.shortcutReset", { action: label })}
                onClick={() => update(action, DEFAULT_SHORTCUTS[action])}
              >
                <RotateCcw {...stylex.props(styles.smallIcon)} />
              </IconButton>
            </div>
          </div>
        );
      })}
      <Button
        onClick={() => {
          onChange({ ...settings, shortcuts: { ...DEFAULT_SHORTCUTS } });
          setRecording(null);
          setError(null);
        }}
        size="sm"
      >
        <RotateCcw {...stylex.props(styles.smallIcon)} />
        {t("settings.shortcutsReset")}
      </Button>
    </div>
  );
}
