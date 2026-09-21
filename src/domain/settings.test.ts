import { describe, expect, it } from "vitest";
import { clampUiScale, DEFAULT_SETTINGS, mergeSettings, type AppSettings } from "./settings";

describe("settings merge", () => {
  it("migrates speech preferences and preserves disabled cleanup", () => {
    expect(mergeSettings({}).speech).toEqual({ model: "small", language: "auto", organize: true });
    expect(mergeSettings({ speech: { model: "base" } }).speech.model).toBe("base");
    expect(mergeSettings({ speech: { model: "unknown" as AppSettings["speech"]["model"] } }).speech.model).toBe("small");
    expect(mergeSettings({ speech: { language: "ja", organize: false } }).speech)
      .toEqual({ model: "small", language: "ja", organize: false });
    expect(mergeSettings({ speech: { language: "invalid" as AppSettings["speech"]["language"] } }).speech.language)
      .toBe("auto");
  });
  it("migrates old settings and preserves custom or disabled shortcuts", () => {
    expect(mergeSettings({}).shortcuts).toEqual(DEFAULT_SETTINGS.shortcuts);
    expect(mergeSettings({ shortcuts: { save: "Mod+Shift+KeyS", newNote: null } }).shortcuts)
      .toEqual({ ...DEFAULT_SETTINGS.shortcuts, save: "Mod+Shift+KeyS", newNote: null });
    expect(mergeSettings({ shortcuts: { save: "KeyS", newNote: "Mod+ControlLeft" } }).shortcuts)
      .toEqual(DEFAULT_SETTINGS.shortcuts);
  });
  it("defaults and clamps interface scale", () => {
    expect(mergeSettings(null).appearance.accent).toBe("ink");
    expect(mergeSettings(null).appearance.uiScale).toBe(1);
    expect(mergeSettings({}).appearance.uiScale).toBe(1);
    expect(
      mergeSettings({
        appearance: { ...DEFAULT_SETTINGS.appearance, uiScale: 1.25 },
      }).appearance.uiScale,
    ).toBe(1.25);
    expect(clampUiScale(0.5)).toBe(0.8);
    expect(clampUiScale(3)).toBe(2);
    expect(clampUiScale("nope")).toBe(1);
  });

  it("defaults and sanitizes locale preference", () => {
    expect(mergeSettings(null).appearance.locale).toBe("system");
    expect(mergeSettings({}).appearance.locale).toBe("system");
    expect(
      mergeSettings({
        appearance: { ...DEFAULT_SETTINGS.appearance, locale: "en" },
      }).appearance.locale,
    ).toBe("en");
    expect(
      mergeSettings({
        appearance: { ...DEFAULT_SETTINGS.appearance, locale: "zh" },
      }).appearance.locale,
    ).toBe("zh");
    expect(
      mergeSettings({
        appearance: {
          ...DEFAULT_SETTINGS.appearance,
          locale: "fr" as AppSettings["appearance"]["locale"],
        },
      }).appearance.locale,
    ).toBe("system");
  });

  it("defaults and sanitizes close behavior", () => {
    expect(mergeSettings(null).general.closeBehavior).toBe("tray");
    expect(mergeSettings({}).general.closeBehavior).toBe("tray");
    expect(
      mergeSettings({
        general: { closeBehavior: "quit" },
      }).general.closeBehavior,
    ).toBe("quit");
    expect(
      mergeSettings({
        general: {
          closeBehavior: "hide" as AppSettings["general"]["closeBehavior"],
        },
      }).general.closeBehavior,
    ).toBe("tray");
  });

  it("defaults and sanitizes note sort", () => {
    expect(mergeSettings(null).general.noteSort).toBe("name");
    expect(mergeSettings(null).general.noteSortDirection).toBe("asc");
    expect(
      mergeSettings({
        general: { ...DEFAULT_SETTINGS.general, noteSort: "modified", noteSortDirection: "desc" },
      }).general,
    ).toMatchObject({ noteSort: "modified", noteSortDirection: "desc" });
    expect(
      mergeSettings({
        general: {
          ...DEFAULT_SETTINGS.general,
          noteSort: "size" as AppSettings["general"]["noteSort"],
          noteSortDirection: "sideways" as AppSettings["general"]["noteSortDirection"],
        },
      }).general,
    ).toMatchObject({ noteSort: "name", noteSortDirection: "asc" });
  });

  it("adds AI defaults when loading older preferences", () => {
    const settings = mergeSettings({
      appearance: { locale: "en" },
      ai: { provider: "ollama", chatModel: "qwen3:8b" },
    });

    expect(settings.ai).toMatchObject({
      enabled: false,
      provider: "ollama",
      baseUrl: "https://api.openai.com/v1",
      embeddingModel: "text-embedding-3-small",
      chatModel: "qwen3:8b",
      contextMaxLength: 256_000,
      embeddingMaxLength: 1_800,
    });
  });

  it("defaults and clamps independent AI length limits", () => {
    expect(mergeSettings({ ai: { contextMaxLength: 500, embeddingMaxLength: 500_000 } }).ai)
      .toMatchObject({ contextMaxLength: 1_000, embeddingMaxLength: 100_000 });
    expect(mergeSettings({ ai: {
      contextMaxLength: Number.NaN,
      embeddingMaxLength: Number.NaN,
    } }).ai).toMatchObject({ contextMaxLength: 256_000, embeddingMaxLength: 1_800 });
  });

  it("falls back to the default AI provider for unknown values", () => {
    expect(
      mergeSettings({
        ai: { provider: "unsupported" as AppSettings["ai"]["provider"] },
      }).ai.provider,
    ).toBe("openai");
  });
});
