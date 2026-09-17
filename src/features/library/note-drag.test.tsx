import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyLibraryStats, type NoteMeta } from "../../domain/notes";
import { DEFAULT_SETTINGS } from "../../domain/settings";
import { useAppStore } from "../../store/app-store";
import { LibrarySidebar } from "./LibrarySidebar";
import { NoteList } from "./NoteList";

const initialState = useAppStore.getState();
const originalElementFromPoint = Object.getOwnPropertyDescriptor(document, "elementFromPoint");
const hitTest = vi.fn();
const moveNote = vi.fn().mockResolvedValue(undefined);
const selectNote = vi.fn().mockResolvedValue(undefined);

function pointer(target: Element | Window, type: string, x = 300, y = 200, button = 0) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button });
  Object.assign(event, { pointerId: 1, pointerType: "mouse" });
  fireEvent(target, event);
}

function setup(path = "学习/note.mdx", count = 1) {
  const note: NoteMeta = {
    relativePath: path,
    fileName: "note.mdx",
    extension: "mdx",
    modifiedMs: 1,
    size: 10,
    title: "Note",
    tags: [],
    excerpt: "Some text",
    favorite: false,
  };
  useAppStore.setState({
    workspaceRoot: "/notes",
    notes: Array.from({ length: count }, (_, index) => index === 0 ? note : {
      ...note, relativePath: `学习/z-note-${index}.mdx`, fileName: `z-note-${index}.mdx`,
    }),
    libraryStats: {
      ...emptyLibraryStats(),
      folders: [{ folder: "", count: 0 }, { folder: "学习", count }, { folder: "工作/归档", count: 0 }],
    },
    settings: DEFAULT_SETTINGS,
    isLoading: false,
    libraryPanelMode: "notes",
    isSidebarCollapsed: false,
    moveNote,
    selectNote,
  });
  const view = render(<>
    <LibrarySidebar isDark={false} onCreateFolder={() => undefined} onCreateTag={() => undefined} />
    <NoteList onCreate={() => undefined} onMove={() => undefined} onRename={() => undefined} onDelete={() => undefined} />
  </>);
  const card = view.container.querySelector<HTMLElement>(`[data-note-card="${path}"]`)!;
  const folder = (label: string) => view.getByRole("button", { name: label });
  const start = (target = folder("归档")) => {
    hitTest.mockReturnValue(target);
    pointer(card, "pointerdown");
    pointer(window, "pointermove", 100, 200);
  };
  return { ...view, card, folder, start };
}

beforeEach(() => {
  vi.clearAllMocks();
  hitTest.mockReturnValue(null);
  Object.defineProperty(document, "elementFromPoint", { configurable: true, value: hitTest });
});

afterEach(() => {
  cleanup();
  useAppStore.setState(initialState, true);
  if (originalElementFromPoint) Object.defineProperty(document, "elementFromPoint", originalElementFromPoint);
  else Reflect.deleteProperty(document, "elementFromPoint");
});

describe("dragging notes to sidebar folders", () => {
  it("highlights a nested folder, moves the source note, and suppresses the resulting click", () => {
    const view = setup();
    view.start();
    const target = view.folder("归档").closest("[data-note-drop-folder]");
    expect(target).toHaveAttribute("data-note-drop-target");
    expect(document.querySelector("[data-note-drag-preview]")).toBeInTheDocument();
    pointer(window, "pointerup", 100, 200);
    fireEvent.click(view.card);
    expect(moveNote).toHaveBeenCalledExactlyOnceWith("学习/note.mdx", "工作/归档");
    expect(selectNote).not.toHaveBeenCalled();
    expect(target).not.toHaveAttribute("data-note-drop-target");
    expect(document.querySelector("[data-note-drag-preview]")).not.toBeInTheDocument();
  });

  it("accepts the root folder and works with virtualized note cards", () => {
    const view = setup("学习/note.mdx", 100);
    view.start(view.folder("根目录"));
    pointer(window, "pointerup", 100, 200);
    expect(moveNote).toHaveBeenCalledExactlyOnceWith("学习/note.mdx", "");
  });

  it("keeps regular clicks and tiny pointer movements working", () => {
    const view = setup();
    pointer(view.card, "pointerdown");
    pointer(window, "pointermove", 302, 202);
    pointer(window, "pointerup", 302, 202);
    fireEvent.click(view.card);
    expect(selectNote).toHaveBeenCalledExactlyOnceWith("学习/note.mdx");
    expect(moveNote).not.toHaveBeenCalled();
  });

  it("does not start dragging with the secondary mouse button", () => {
    const view = setup();
    hitTest.mockReturnValue(view.folder("归档"));
    pointer(view.card, "pointerdown", 300, 200, 2);
    pointer(window, "pointermove", 100, 200, 2);
    pointer(window, "pointerup", 100, 200, 2);
    expect(moveNote).not.toHaveBeenCalled();
    expect(document.querySelector("[data-note-drag-preview]")).not.toBeInTheDocument();
  });

  it.each(["学习", "所有笔记 0"])("ignores drops onto %s", (label) => {
    const view = setup();
    view.start(view.folder(label));
    expect(document.querySelector("[data-note-drop-target]")).not.toBeInTheDocument();
    pointer(window, "pointerup", 100, 200);
    expect(moveNote).not.toHaveBeenCalled();
  });

  it("clears the highlight when leaving a target and ignores an outside drop", () => {
    const view = setup();
    view.start();
    hitTest.mockReturnValue(null);
    pointer(window, "pointermove", 500, 200);
    expect(document.querySelector("[data-note-drop-target]")).not.toBeInTheDocument();
    pointer(window, "pointerup", 500, 200);
    expect(moveNote).not.toHaveBeenCalled();
  });

  it("scrolls the sidebar near its edge and stops scrolling after the drop", () => {
    let nextFrame: FrameRequestCallback = () => undefined;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      nextFrame = callback;
      return 42;
    });
    const cancelFrame = vi.spyOn(window, "cancelAnimationFrame");
    const view = setup();
    const scroller = view.container.querySelector<HTMLElement>("[data-library-folder-scroller]")!;
    vi.spyOn(scroller, "getBoundingClientRect").mockReturnValue({ top: 0, bottom: 210 } as DOMRect);
    view.start();
    act(() => nextFrame(16));
    expect(scroller.scrollTop).toBe(8);
    pointer(window, "pointerup", 100, 200);
    expect(cancelFrame).toHaveBeenCalledWith(42);
  });

  it("does not move a note if another operation starts before the drop", () => {
    const view = setup();
    view.start();
    act(() => useAppStore.setState({ isLoading: true }));
    pointer(window, "pointerup", 100, 200);
    expect(moveNote).not.toHaveBeenCalled();
  });

  it.each(["Escape", "pointercancel", "blur", "workspace", "unmount"])("cancels on %s", (reason) => {
    const view = setup();
    view.start();
    if (reason === "Escape") fireEvent.keyDown(window, { key: "Escape" });
    else if (reason === "pointercancel") pointer(window, "pointercancel");
    else if (reason === "blur") fireEvent.blur(window);
    else if (reason === "workspace") act(() => useAppStore.setState({ workspaceRoot: "/other" }));
    else view.unmount();
    pointer(window, "pointerup", 100, 200);
    expect(moveNote).not.toHaveBeenCalled();
    expect(document.querySelector("[data-note-drop-target]")).not.toBeInTheDocument();
    expect(document.querySelector("[data-note-drag-preview]")).not.toBeInTheDocument();
  });
});
