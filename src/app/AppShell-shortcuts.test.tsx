import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../domain/settings";
import { DEFAULT_WORKSPACE_LAYOUT } from "../domain/layout";
import { setGatewaysForTests } from "../gateways";
import { useAppStore } from "../store/app-store";
import { createMockGateways } from "../test/mock-gateways";
import AppShell from "./AppShell";

afterEach(() => {
  cleanup();
  setGatewaysForTests(null);
});

describe("AppShell shortcuts", () => {
  it("uses changed bindings and suppresses application actions while recording", async () => {
    const initialize = useAppStore.getState().initialize;
    const settings = {
      ...DEFAULT_SETTINGS,
      appearance: { ...DEFAULT_SETTINGS.appearance, locale: "zh" as const },
    };
    setGatewaysForTests(createMockGateways());
    useAppStore.setState({
      initialize: async () => undefined,
      initialized: true,
      workspaceRoot: "/workspace",
      isSidebarCollapsed: false,
      layout: DEFAULT_WORKSPACE_LAYOUT,
      settings,
    });
    try {
      const user = userEvent.setup();
      const view = render(<AppShell />);
      await waitFor(() => expect(view.container.querySelector("[data-workspace-shell]")).toBeTruthy());
      fireEvent.keyDown(window, { key: "b", code: "KeyB", ctrlKey: true });
      expect(useAppStore.getState().isSidebarCollapsed).toBe(true);
      act(() => useAppStore.getState().setSettings({
        ...settings,
        shortcuts: { ...DEFAULT_SETTINGS.shortcuts, toggleSidebar: "Mod+Shift+KeyB" },
      }));
      fireEvent.keyDown(window, { key: "b", code: "KeyB", ctrlKey: true });
      expect(useAppStore.getState().isSidebarCollapsed).toBe(true);
      fireEvent.keyDown(window, { key: "B", code: "KeyB", ctrlKey: true, shiftKey: true });
      expect(useAppStore.getState().isSidebarCollapsed).toBe(false);

      const focus = await view.findByRole("button", { name: "专注书写" });
      fireEvent.keyDown(window, { key: "F", code: "KeyF", ctrlKey: true, shiftKey: true });
      expect(useAppStore.getState().layout.libraryCollapsed).toBe(true);
      expect(useAppStore.getState().isSidebarCollapsed).toBe(true);
      fireEvent.keyDown(window, { key: "F", code: "KeyF", ctrlKey: true, shiftKey: true, repeat: true });
      expect(useAppStore.getState().layout.libraryCollapsed).toBe(true);
      await user.click(focus);
      expect(useAppStore.getState().layout.libraryCollapsed).toBe(false);
      expect(useAppStore.getState().isSidebarCollapsed).toBe(false);
      await user.click(focus);
      fireEvent.keyDown(window, { key: "F", code: "KeyF", metaKey: true, shiftKey: true });
      expect(useAppStore.getState().layout.libraryCollapsed).toBe(false);
      expect(useAppStore.getState().isSidebarCollapsed).toBe(false);

      act(() => useAppStore.getState().openSettings("shortcuts"));
      const record = await view.findByRole("button", { name: "修改保存笔记快捷键" });
      await user.click(record);
      fireEvent.keyDown(record, { key: "B", code: "KeyB", ctrlKey: true, shiftKey: true });
      expect(useAppStore.getState().isSidebarCollapsed).toBe(false);
      expect(view.getByRole("alert")).toHaveTextContent("切换侧边栏");
      fireEvent.keyDown(record, { key: "s", code: "KeyS", ctrlKey: true, shiftKey: true });
      expect(useAppStore.getState().settings.shortcuts.save).toBe("Mod+Shift+KeyS");
      const recordFocus = view.getByRole("button", { name: "修改切换沉浸模式快捷键" });
      expect(recordFocus).toHaveTextContent("Ctrl + Shift + F");
      await user.click(recordFocus);
      fireEvent.keyDown(recordFocus, { key: "i", code: "KeyI", ctrlKey: true });
      expect(useAppStore.getState().settings.shortcuts.toggleFocus).toBe("Mod+KeyI");
      act(() => useAppStore.getState().closeSettings());
      fireEvent.keyDown(window, { key: "F", code: "KeyF", ctrlKey: true, shiftKey: true });
      expect(useAppStore.getState().layout.libraryCollapsed).toBe(false);
      fireEvent.keyDown(window, { key: "i", code: "KeyI", ctrlKey: true });
      expect(useAppStore.getState().layout.libraryCollapsed).toBe(true);
      fireEvent.keyDown(window, { key: "i", code: "KeyI", ctrlKey: true });
      expect(useAppStore.getState().layout.libraryCollapsed).toBe(false);
    } finally {
      cleanup();
      act(() => useAppStore.setState({ initialize }));
    }
  });
});
