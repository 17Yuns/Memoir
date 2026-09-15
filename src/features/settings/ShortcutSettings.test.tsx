import { cleanup, fireEvent, render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../../domain/settings";
import { globalShortcutAction } from "../../platform/shortcuts";
import SettingsDialog from "./SettingsDialog";

afterEach(cleanup);

function Harness({ onClose = () => undefined, onChange = () => undefined }) {
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  return <SettingsDialog
    open section="shortcuts" settings={settings}
    onClose={onClose} onReset={() => undefined} onSectionChange={() => undefined}
    onSettingsChange={(next) => { setSettings(next); onChange(); }}
  />;
}

describe("shortcut settings", () => {
  it("records a binding without dispatching an application shortcut", async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    const listener = (event: KeyboardEvent) => {
      const action = globalShortcutAction(event);
      if (action) onAction(action);
    };
    window.addEventListener("keydown", listener);
    try {
      const view = render(<Harness />);
      const button = view.getByRole("button", { name: "修改保存笔记快捷键" });
      expect(button).toHaveTextContent("Ctrl + S");
      await user.click(button);
      fireEvent.keyDown(button, { key: "s", code: "KeyS", ctrlKey: true, shiftKey: true });
      expect(button).toHaveTextContent("Ctrl + Shift + S");
      expect(button).toHaveAttribute("aria-pressed", "false");
      expect(onAction).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("keydown", listener);
    }
  });

  it("rejects conflicts and invalid keys and cancels without closing the dialog", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onChange = vi.fn();
    const view = render(<Harness onClose={onClose} onChange={onChange} />);
    const button = view.getByRole("button", { name: "修改保存笔记快捷键" });
    await user.click(button);
    fireEvent.keyDown(button, { key: "n", code: "KeyN", ctrlKey: true });
    expect(view.getByRole("alert")).toHaveTextContent("新建笔记");
    fireEvent.keyDown(button, { key: "+", code: "Equal", ctrlKey: true, shiftKey: true });
    expect(view.getByRole("alert")).toHaveTextContent("放大界面");
    fireEvent.keyDown(button, { key: "s", code: "KeyS" });
    expect(view.getByRole("alert")).toHaveTextContent("请使用 Ctrl");
    fireEvent.keyDown(button, { key: "Escape", code: "Escape" });
    expect(button).toHaveTextContent("Ctrl + S");
    expect(view.queryByRole("alert")).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("disables and restores bindings, guarding against conflicts on reset", async () => {
    const user = userEvent.setup();
    const view = render(<Harness />);
    const save = view.getByRole("button", { name: "修改保存笔记快捷键" });
    await user.click(view.getByRole("button", { name: "停用保存笔记快捷键" }));
    expect(save).toHaveTextContent("未设置");
    const newNote = view.getByRole("button", { name: "修改新建笔记快捷键" });
    await user.click(newNote);
    fireEvent.keyDown(newNote, { key: "s", code: "KeyS", metaKey: true });
    expect(newNote).toHaveTextContent("Ctrl + S");
    await user.click(view.getByRole("button", { name: "恢复保存笔记默认快捷键" }));
    expect(view.getByRole("alert")).toHaveTextContent("新建笔记");
    expect(save).toHaveTextContent("未设置");
    await user.click(view.getByRole("button", { name: "恢复全部默认快捷键" }));
    expect(save).toHaveTextContent("Ctrl + S");
    expect(newNote).toHaveTextContent("Ctrl + N");
    expect(view.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("lets Tab leave recording without changing the binding", async () => {
    const user = userEvent.setup();
    const view = render(<Harness />);
    const button = view.getByRole("button", { name: "修改保存笔记快捷键" });
    await user.click(button);
    await user.tab();
    expect(button).toHaveAttribute("aria-pressed", "false");
    expect(button).toHaveTextContent("Ctrl + S");
    expect(view.getByRole("button", { name: "停用保存笔记快捷键" })).toHaveFocus();
  });
});
