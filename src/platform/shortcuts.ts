import {
  DEFAULT_SHORTCUTS,
  isShortcutBinding,
  SHORTCUT_ACTIONS,
  type GlobalShortcutAction,
  type ShortcutSettings,
} from "../domain/shortcuts";

export type { GlobalShortcutAction } from "../domain/shortcuts";

export function shortcutFromEvent(event: KeyboardEvent): string | null {
  if (event.isComposing || event.getModifierState("AltGraph")) return null;
  if (!(event.metaKey || event.ctrlKey) || (event.metaKey && event.ctrlKey)) return null;
  const aliases: Record<string, string> = {
    NumpadAdd: "Equal", NumpadSubtract: "Minus", Numpad0: "Digit0",
  };
  const code = aliases[event.code] ?? event.code;
  const binding = `Mod+${event.altKey ? "Alt+" : ""}${event.shiftKey ? "Shift+" : ""}${code}`;
  return isShortcutBinding(binding) ? binding : null;
}

export function globalShortcutAction(
  event: KeyboardEvent,
  shortcuts: ShortcutSettings = DEFAULT_SHORTCUTS,
): GlobalShortcutAction | null {
  if (event.defaultPrevented) return null;
  const binding = shortcutFromEvent(event);
  if (!binding) return null;
  const action = SHORTCUT_ACTIONS.find((candidate) => shortcuts[candidate] === binding);
  if (action) return action;
  // Keep Ctrl/Cmd + '+' working with the default zoom binding.
  if (binding === "Mod+Shift+Equal" && shortcuts.zoomIn === DEFAULT_SHORTCUTS.zoomIn) {
    return "zoomIn";
  }
  return null;
}
