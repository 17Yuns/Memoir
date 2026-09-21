import { EditorView } from "@codemirror/view";
import { act, cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { EchoSession } from "../../application/echo-session";
import { DEFAULT_SETTINGS } from "../../domain/settings";
import { noteRefsFromGraph } from "../../domain/note-links";
import { emptyVectorIndexStatus } from "../../domain/vector-index";
import { setGatewaysForTests } from "../../gateways";
import { useAppStore } from "../../store/app-store";
import { createMockGateways } from "../../test/mock-gateways";
import { EditorPane, type EditorHandle } from "../editor/EditorPane";
import { EchoPanel } from "./EchoPanel";

beforeAll(async () => {
  await import("../preview/NotePreviewArticle");
  // jsdom does not implement range geometry used by CodeMirror's measurement pass.
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
});

const initialState = useAppStore.getState();
afterEach(() => { cleanup(); setGatewaysForTests(null); useAppStore.setState(initialState, true); });

async function setup() {
  const gateways = createMockGateways();
  const original = "Writing connects memories and older ideas.\n\nAlready linked [[Linked]].";
  gateways.workspace.files = new Map([
    ["source.md", original],
    ["linked.md", "# Linked\n\nAn already linked note."],
    ["a/memory.md", "# Memory\n\nLatest original content.\n\n- [ ] Read [[../b/memory.md]]"],
    ["b/memory.md", "# Memory\n\nAnother original note."],
  ]);
  gateways.workspace.vectorIndexStatus = emptyVectorIndexStatus({ enabled: true, model: DEFAULT_SETTINGS.ai.embeddingModel, totalNotes: 5, indexedNotes: 4, chunkCount: 4 });
  gateways.workspace.semanticResults = ["linked.md", "a/memory.md", "b/memory.md"].map((relativePath, i) => ({ relativePath,
    title: i === 0 ? "Linked" : "Memory", content: `Matched chunk ${i}`, excerpt: "Do not show generic summary", score: .9 - i * .1, chunkIndex: 0 }));
  setGatewaysForTests(gateways);
  const selectNote = vi.fn();
  useAppStore.setState({ workspaceRoot: "/workspace", activePath: "source.md", loadedContentPath: "source.md", notes: [],
    content: original, savedContent: original, settings: { ...DEFAULT_SETTINGS, ai: { ...DEFAULT_SETTINGS.ai, enabled: true } },
    viewMode: "edit", isLoading: false, selectNote, layout: { ...initialState.layout, libraryCollapsed: false } });
  const search = vi.spyOn(gateways.workspace, "semanticSearch");
  const session = new EchoSession((...args) => gateways.workspace.semanticSearch(...args));
  const ref = createRef<EditorHandle>();
  const ui = render(<><EditorPane content={original} sourcePath="source.md" fileName="source.md" ref={ref}
    settings={DEFAULT_SETTINGS} isDark={false} onChange={(content) => useAppStore.setState({ content })} onEchoContext={session.setContext} />
    <EchoPanel session={session} editorRef={ref} /></>);
  const cm = EditorView.findFromDOM(ui.container.querySelector(".cm-editor")!)!;
  act(() => cm.dispatch({ selection: { anchor: 0, head: 40 } }));
  await waitFor(() => expect(ui.getByText(/4 \/ 5/)).toBeInTheDocument());
  act(() => session.refresh());
  await waitFor(() => expect(ui.getByText("Matched chunk 1")).toBeInTheDocument());
  return { ui, cm, ref, session, gateways, original, selectNote, search };
}

describe("Echo reading and insertion", () => {
  it("previews fresh content, navigates inside the dialog and restores the main editor", async () => {
    const { ui, cm, ref, original, selectNote, search } = await setup();
    const source = ref.current!.captureEcho()!;
    const scroll = cm.scrollDOM.scrollTop = 75;
    expect(ui.queryByText("Do not show generic summary")).not.toBeInTheDocument();
    expect(within(ui.getByRole("list", { name: "相关候选" })).getAllByRole("listitem")).toHaveLength(2);
    expect(ui.queryByRole("button", { name: /Memory b\/memory.md/ })).not.toBeInTheDocument();
    expect(ui.getByRole("button", { name: "已引用" })).toBeDisabled();
    fireEvent.click(ui.getByRole("button", { name: /Memory a\/memory.md/ }));
    const dialog = await ui.findByRole("dialog");
    await waitFor(() => expect(within(dialog).getByText("Latest original content.")).toBeInTheDocument());
    expect(within(dialog).getByRole("checkbox")).toBeDisabled();
    expect(ref.current!.captureEcho()!.doc).toBe(source.doc);
    await waitFor(() => expect(within(dialog).getByRole("link", { name: "memory" })).not.toHaveAttribute("data-wiki-link-missing"));
    fireEvent.click(within(dialog).getByRole("link", { name: "memory" }));
    await waitFor(() => expect(within(dialog).getByText("Another original note.")).toBeInTheDocument());
    expect(selectNote).not.toHaveBeenCalled();
    expect(useAppStore.getState().activePath).toBe("source.md");
    fireEvent.click(within(dialog).getByRole("button", { name: "关闭" }));
    await waitFor(() => expect(cm.hasFocus).toBe(true));
    expect(ref.current!.getSelection()).toMatchObject({ from: 0, to: 40 });
    expect(ref.current!.flushContent()).toBe(original);
    expect(cm.scrollDOM.scrollTop).toBe(scroll);
    expect(search).toHaveBeenCalledTimes(1);
  });

  it("appends after selection, isolates undo, and saves resolvable outgoing and incoming links", async () => {
    const { ui, cm, ref, original, gateways } = await setup();
    fireEvent.click(ui.getByRole("button", { name: /Memory a\/memory.md/ }));
    const dialog = await ui.findByRole("dialog");
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "插入双链" })).toBeEnabled());
    fireEvent.click(within(dialog).getByRole("button", { name: "插入双链" }));
    const expected = original.slice(0, 40) + "[[./a/memory.md]]" + original.slice(40);
    await waitFor(() => expect(ref.current!.flushContent()).toBe(expected));
    expect(cm.state.selection.main.head).toBe(40 + "[[./a/memory.md]]".length);
    await gateways.workspace.writeNote("/workspace", "source.md", expected);
    const graph = await gateways.workspace.getNoteGraph("/workspace");
    expect(graph.edges).toContainEqual(expect.objectContaining({ sourcePath: "source.md", targetPath: "a/memory.md" }));
    expect(noteRefsFromGraph(graph, "a/memory.md").incoming).toContainEqual(expect.objectContaining({ sourcePath: "source.md" }));
    act(() => ref.current!.undo());
    act(() => { expect(ref.current!.flushContent()).toBe(original); });
    expect(useAppStore.getState().content).toBe(original);
  });

  it("refuses stale coordinates even if an external edit was undone", async () => {
    const { ui, ref } = await setup();
    fireEvent.click(ui.getByRole("button", { name: /Memory a\/memory.md/ }));
    const dialog = await ui.findByRole("dialog");
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "插入双链" })).toBeEnabled());
    act(() => { ref.current!.insertRaw("changed"); ref.current!.undo(); });
    fireEvent.click(within(dialog).getByRole("button", { name: "插入双链" }));
    await waitFor(() => expect(within(dialog).getByRole("alert")).toHaveTextContent("写作位置已变化"));
    expect(within(dialog).getByRole("button", { name: "插入双链" })).toBeDisabled();
  });

  it("disables insertion when the original note was deleted", async () => {
    const { ui, gateways } = await setup();
    gateways.workspace.files.delete("a/memory.md");
    fireEvent.click(ui.getByRole("button", { name: /Memory a\/memory.md/ }));
    const dialog = await ui.findByRole("dialog");
    await waitFor(() => expect(within(dialog).getByRole("alert")).toHaveTextContent("无法读取原文"));
    expect(within(dialog).getByRole("button", { name: "插入双链" })).toBeDisabled();
  });

  it("inserts at a cursor with no selection and captures composition boundaries", async () => {
    const { ui, cm, ref, session, original } = await setup();
    act(() => cm.dispatch({ selection: { anchor: 10 } }));
    fireEvent.compositionStart(cm.contentDOM);
    expect(session.getSnapshot().context?.composing).toBe(true);
    fireEvent.compositionEnd(cm.contentDOM);
    await waitFor(() => expect(session.getSnapshot().context?.composing).toBe(false));
    const card = ui.getByRole("button", { name: /Memory a\/memory.md/ }).parentElement!;
    fireEvent.click(within(card).getByRole("button", { name: "插入双链" }));
    await waitFor(() => expect(ref.current!.captureEcho()!.doc.toString()).toBe(original.slice(0, 10) + "[[./a/memory.md]]" + original.slice(10)));
    act(() => { ref.current!.undo(); ref.current!.flushContent(); });
    expect(ref.current!.captureEcho()!.doc.toString()).toBe(original);
  });

  it("shows index actions for an empty or mismatched index without querying or indexing", async () => {
    const { ui, gateways, search } = await setup();
    gateways.workspace.vectorIndexStatus = emptyVectorIndexStatus({ enabled: true, model: "older-model" });
    fireEvent.click(ui.getByRole("button", { name: "刷新回响" }));
    await waitFor(() => expect(ui.getByText("索引与当前模型配置不匹配。")).toBeInTheDocument());
    const count = search.mock.calls.length;
    gateways.workspace.vectorIndexStatus = emptyVectorIndexStatus({ enabled: true, model: DEFAULT_SETTINGS.ai.embeddingModel });
    fireEvent.click(ui.getByRole("button", { name: "刷新回响" }));
    await waitFor(() => expect(ui.getByText(/当前配置下没有可用索引/)).toBeInTheDocument());
    expect(search).toHaveBeenCalledTimes(count);
    fireEvent.click(ui.getByRole("button", { name: "管理索引" }));
    expect(useAppStore.getState().libraryPanelMode).toBe("index");
    expect(gateways.workspace.vectorIndexCalls).toBe(0);
  });

  it("pauses for a hidden panel or pure preview, and exposes index/settings actions without indexing", async () => {
    const { ui, session, search, gateways } = await setup();
    act(() => useAppStore.setState({ layout: { ...initialState.layout, libraryCollapsed: true } }));
    act(() => session.refresh());
    expect(session.getSnapshot().loading).toBe(false);
    expect(search).toHaveBeenCalledTimes(1);
    act(() => useAppStore.setState({ layout: { ...initialState.layout, libraryCollapsed: false }, viewMode: "preview" }));
    expect(ui.getByRole("button", { name: "刷新回响" })).toBeDisabled();
    act(() => useAppStore.setState({ settings: DEFAULT_SETTINGS }));
    fireEvent.click(ui.getByRole("button", { name: "AI 设置" }));
    expect(useAppStore.getState().settingsSection).toBe("ai");
    expect(gateways.workspace.vectorIndexCalls).toBe(0);
  });
});
