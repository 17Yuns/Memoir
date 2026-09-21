import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SpeechDialog } from "./SpeechDialog";
import { DEFAULT_SETTINGS } from "../../domain/settings";
import { createMockGateways } from "../../test/mock-gateways";
import { setGatewaysForTests } from "../../gateways";
import { useAppStore } from "../../store/app-store";

function setup({ ready = true, organize = true, microphoneError = false, model = "small" as "small" | "base" } = {}) {
  const gateways = createMockGateways();
  gateways.speech = {
    available: true, modelStatus: vi.fn().mockResolvedValue({ ready, model: "small", bytes: 190085487 }),
    chooseModel: vi.fn(), installModel: vi.fn(),
    start: vi.fn().mockResolvedValue(undefined), stop: vi.fn().mockResolvedValue({ text: "原始文字", segments: [] }),
    cancel: vi.fn().mockResolvedValue(undefined), format: vi.fn().mockResolvedValue("整理文字"),
    watchProgress: vi.fn().mockResolvedValue(vi.fn()),
  };
  if (microphoneError) vi.mocked(gateways.speech.start).mockRejectedValueOnce(new Error("speech.microphoneError"));
  setGatewaysForTests(gateways);
  useAppStore.setState({ workspaceRoot: "/notes", activePath: "one.md", content: "old", viewMode: "split", settings: { ...DEFAULT_SETTINGS, speech: { model, language: "en", organize }, ai: { ...DEFAULT_SETTINGS.ai, enabled: true } } });
  const insert = vi.fn().mockReturnValue(true);
  const close = vi.fn();
  const getAnchor = vi.fn(() => ({ left: 320, right: 320, top: 200, bottom: 220 }));
  const view = render(<StrictMode><SpeechDialog target={{ root: "/notes", path: "one.md", content: "old", from: 0 }} getAnchor={getAnchor} onClose={close} onInsert={insert} /></StrictMode>);
  return { view, gateways, insert, close, getAnchor, user: userEvent.setup() };
}
afterEach(() => {
  cleanup(); setGatewaysForTests(null);
  useAppStore.setState({ workspaceRoot: null, activePath: null, content: "", settings: DEFAULT_SETTINGS });
});

describe("SpeechDialog", () => {
  it("keeps the editor interactive without stealing focus or cancelling on outside clicks", async () => {
    const editor = document.createElement("textarea");
    document.body.append(editor);
    editor.focus();
    const { view, gateways, close, user } = setup();
    try {
      await view.findByRole("button", { name: "停止并转写" });
      expect(view.getByRole("dialog", { name: "语音输入" })).toHaveAttribute("aria-modal", "false");
      expect(editor).toHaveFocus();
      expect(view.queryByRole("button", { name: "插入笔记" })).not.toBeInTheDocument();
      await user.click(editor);
      await user.keyboard("still editing{Escape}");
      expect(editor).toHaveValue("still editing");
      expect(close).not.toHaveBeenCalled();
      expect(gateways.speech.cancel).not.toHaveBeenCalled();
      await user.click(view.getByRole("button", { name: "关闭" }));
      expect(close).toHaveBeenCalledTimes(1);
      expect(gateways.speech.cancel).toHaveBeenCalled();
    } finally { editor.remove(); }
  });

  it("refreshes its insertion anchor on scroll and resize and closes with Escape inside the panel", async () => {
    const { view, close, getAnchor, user } = setup();
    const stop = await view.findByRole("button", { name: "停止并转写" });
    getAnchor.mockClear();
    fireEvent.scroll(document);
    expect(getAnchor).toHaveBeenCalledTimes(1);
    fireEvent.resize(window);
    expect(getAnchor).toHaveBeenCalledTimes(2);
    stop.focus();
    await user.keyboard("{Escape}");
    expect(close).toHaveBeenCalledTimes(1);
    view.unmount();
    getAnchor.mockClear();
    fireEvent.scroll(document);
    expect(getAnchor).not.toHaveBeenCalled();
  });

  it("starts once on opening and uses saved recognition and cleanup preferences", async () => {
    const { view, gateways, user } = setup({ organize: false, model: "base" });
    await user.click(await view.findByRole("button", { name: "停止并转写" }));
    await view.findByRole("textbox", { name: "转写结果" });
    expect(gateways.speech.start).toHaveBeenCalledTimes(1);
    expect(gateways.speech.start).toHaveBeenCalledWith(expect.any(String), "base");
    expect(gateways.speech.stop).toHaveBeenCalledWith(expect.any(String), "en");
    expect(gateways.speech.format).not.toHaveBeenCalled();
    expect(view.queryByRole("combobox")).not.toBeInTheDocument();
    expect(view.queryByRole("switch")).not.toBeInTheDocument();
    expect(view.queryByText("本地语音模型已就绪")).not.toBeInTheDocument();
  });

  it("links to voice settings when the model is missing without recording", async () => {
    const { view, gateways, user, close } = setup({ ready: false });
    await user.click(await view.findByRole("button", { name: "前往语音设置" }));
    expect(gateways.speech.start).not.toHaveBeenCalled();
    expect(view.queryByRole("button", { name: "下载模型" })).not.toBeInTheDocument();
    expect(close).toHaveBeenCalled();
    expect(useAppStore.getState().settingsSection).toBe("speech");
  });

  it("allows retry after microphone startup fails", async () => {
    const { view, gateways, user } = setup({ microphoneError: true });
    await view.findByRole("alert");
    await user.click(view.getByRole("button", { name: "开始录音" }));
    await view.findByRole("button", { name: "停止并转写" });
    expect(gateways.speech.start).toHaveBeenCalledTimes(2);
  });

  it("previews cleaned text, allows switching to the original, and inserts the reviewed result", async () => {
    const { view, insert, user } = setup();
    await user.click(await view.findByRole("button", { name: "停止并转写" }));
    await waitFor(() => expect(view.getByRole("textbox", { name: "转写结果" })).toHaveValue("整理文字"));
    await user.click(view.getByRole("button", { name: "原始转写" }));
    expect(view.getByRole("textbox", { name: "转写结果" })).toHaveValue("原始文字");
    fireEvent.change(view.getByRole("textbox", { name: "转写结果" }), { target: { value: "人工校对文字" } });
    await user.click(view.getByRole("button", { name: "插入笔记" }));
    expect(insert).toHaveBeenCalledWith("人工校对文字");
  });

  it("blocks insertion if the originating note changed", async () => {
    const { view, insert, user } = setup();
    await user.click(await view.findByRole("button", { name: "停止并转写" }));
    await view.findByRole("textbox", { name: "转写结果" });
    act(() => useAppStore.setState({ activePath: "other.md" }));
    await waitFor(() => expect(view.getByRole("button", { name: "插入笔记" })).toBeDisabled());
    expect(view.getByRole("alert")).toHaveTextContent("原笔记已切换");
    expect(insert).not.toHaveBeenCalled();
  });

  it("releases the microphone when unmounted while recording", async () => {
    const { view, gateways } = setup();
    await view.findByRole("button", { name: "停止并转写" });
    view.unmount();
    expect(gateways.speech.cancel).toHaveBeenCalledWith(vi.mocked(gateways.speech.start).mock.calls[0][0]);
  });
});
