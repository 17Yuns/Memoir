import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../domain/settings";
import { DEFAULT_WORKSPACE_LAYOUT } from "../domain/layout";
import { setGatewaysForTests } from "../gateways";
import { useAppStore } from "../store/app-store";
import { createMockGateways } from "../test/mock-gateways";
import AppShell from "./AppShell";

beforeAll(async () => {
  await Promise.all([import("../features/editor/EditorWorkspace"), import("../features/editor/EditorPane")]);
});
afterEach(() => { cleanup(); setGatewaysForTests(null); });

it("starts and stops voice input from the editor, respects guards and uses changed bindings", async () => {
  // JSDOM has no text layout; keep the real editor and stub only cursor geometry.
  vi.spyOn(EditorView.prototype, "coordsAtPos").mockReturnValue({ left: 300, right: 300, top: 120, bottom: 140 });
  const previous = useAppStore.getState();
  const gateways = createMockGateways();
  gateways.speech = {
    available: true,
    modelStatus: vi.fn().mockResolvedValue({ ready: true, model: "small", bytes: 190085487 }),
    chooseModel: vi.fn(), installModel: vi.fn(),
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue({ text: "听写文字", segments: [] }),
    cancel: vi.fn().mockResolvedValue(undefined), format: vi.fn(),
    watchProgress: vi.fn().mockResolvedValue(vi.fn()),
  };
  setGatewaysForTests(gateways);
  useAppStore.setState({
    initialize: async () => undefined, initialized: true, workspaceRoot: "/workspace",
    settingsOpen: false, isLoading: false, libraryPanelMode: "notes", viewMode: "edit",
    layout: DEFAULT_WORKSPACE_LAYOUT, isSidebarCollapsed: false,
    notes: [{ relativePath: "alpha.md", fileName: "alpha.md", extension: "md", modifiedMs: 1,
      size: 5, title: "Alpha", tags: [], excerpt: "", favorite: false }],
    activePath: "alpha.md", loadedContentPath: "alpha.md", content: "Alpha", savedContent: "Alpha",
    settings: { ...DEFAULT_SETTINGS, appearance: { ...DEFAULT_SETTINGS.appearance, locale: "zh" },
      speech: { ...DEFAULT_SETTINGS.speech, organize: false } },
  });
  try {
    const view = render(<AppShell />);
    await waitFor(() => expect(view.container.querySelector(".cm-content")).toBeTruthy());
    const press = (options: KeyboardEventInit = {}) => fireEvent.keyDown(window, {
      key: "M", code: "KeyM", ctrlKey: true, shiftKey: true, ...options,
    });
    expect(view.getByRole("button", { name: "语音输入" })).toHaveAttribute("title", "语音输入 (Ctrl + Shift + M)");

    act(() => useAppStore.setState({ viewMode: "preview" }));
    press();
    expect(view.queryByRole("dialog", { name: "语音输入" })).not.toBeInTheDocument();
    act(() => useAppStore.setState({ viewMode: "edit", loadedContentPath: null }));
    press();
    expect(view.queryByRole("dialog", { name: "语音输入" })).not.toBeInTheDocument();
    act(() => useAppStore.setState({ loadedContentPath: "alpha.md" }));
    await waitFor(() => expect(view.container.querySelector(".cm-content")).toBeTruthy());
    // An unrelated modal must never start the microphone in the background.
    const modal = document.createElement("div");
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    document.body.append(modal);
    press();
    modal.remove();
    expect(gateways.speech.start).not.toHaveBeenCalled();

    fireEvent.keyDown(view.container.querySelector(".cm-content")!, { key: "M", code: "KeyM", ctrlKey: true, shiftKey: true });
    await view.findByRole("button", { name: "停止并转写" });
    expect(gateways.speech.start).toHaveBeenCalledTimes(1);
    press({ repeat: true });
    expect(gateways.speech.stop).not.toHaveBeenCalled();
    press({ ctrlKey: false, metaKey: true });
    const transcript = await view.findByRole("textbox", { name: "转写结果" });
    expect(transcript).toHaveValue("听写文字");
    expect(gateways.speech.stop).toHaveBeenCalledTimes(1);
    press();
    expect(transcript).toHaveFocus();
    expect(gateways.speech.start).toHaveBeenCalledTimes(1);
    fireEvent.click(view.getByRole("button", { name: "关闭" }));

    act(() => useAppStore.setState({ settings: { ...useAppStore.getState().settings,
      shortcuts: { ...DEFAULT_SETTINGS.shortcuts, voiceInput: "Mod+Alt+KeyR" } } }));
    press();
    expect(view.queryByRole("dialog", { name: "语音输入" })).not.toBeInTheDocument();
    press({ code: "KeyR", key: "r", shiftKey: false, altKey: true });
    await view.findByRole("button", { name: "停止并转写" });
    expect(gateways.speech.start).toHaveBeenCalledTimes(2);
  } finally {
    cleanup();
    useAppStore.setState(previous, true);
  }
});
