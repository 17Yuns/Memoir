import * as stylex from "@stylexjs/stylex";
import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { create } from "zustand";
import { useAppStore } from "../../store/app-store";
import { noteListStyles } from "./library-styles.stylex";

type NoteDrag = {
  path: string;
  label: string;
  x: number;
  y: number;
  folder: string | null;
};

const useNoteDragState = create<{ drag: NoteDrag | null }>(() => ({ drag: null }));

export function useNoteDropFolder() {
  return useNoteDragState((state) => state.drag?.folder ?? null);
}

function folderAtPoint(x: number, y: number, path: string) {
  const row = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-note-drop-folder]");
  const folder = row?.dataset.noteDropFolder;
  const sourceFolder = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
  return folder !== undefined && folder !== sourceFolder ? folder : null;
}

// Pointer dragging coexists with Tauri's native file-drop handler, which is
// needed for attachments and can intercept HTML drag/drop on desktop hosts.
export function useNoteDrag() {
  const workspaceRoot = useAppStore((state) => state.workspaceRoot);
  const mode = useAppStore((state) => state.libraryPanelMode);
  const stopRef = useRef<(() => void) | null>(null);
  const suppressClick = useRef(false);

  useEffect(() => () => stopRef.current?.(), [workspaceRoot, mode]);

  const onPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0 || event.pointerType === "touch") return;
    const card = (event.target as Element).closest<HTMLElement>("[data-note-card]");
    const path = card?.dataset.noteCard;
    if (!card || !path || !workspaceRoot || useAppStore.getState().isLoading) return;
    stopRef.current?.();
    suppressClick.current = false;
    const pointerId = event.pointerId;
    const startX = event.clientX;
    const startY = event.clientY;
    let dragging = false;
    let x = startX;
    let y = startY;
    let frame = 0;

    const update = () => {
      useNoteDragState.setState({
        drag: { path, label: card.getAttribute("aria-label") || path, x, y, folder: folderAtPoint(x, y, path) },
      });
    };
    const scroll = () => {
      const scroller = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-library-folder-scroller]");
      if (scroller) {
        const bounds = scroller.getBoundingClientRect();
        const delta = y < bounds.top + 32 ? -8 : y > bounds.bottom - 32 ? 8 : 0;
        if (delta) {
          scroller.scrollTop += delta;
          update();
        }
      }
      frame = window.requestAnimationFrame(scroll);
    };
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("blur", stop);
      window.removeEventListener("keydown", keydown, true);
      window.cancelAnimationFrame(frame);
      if (card.hasPointerCapture?.(pointerId)) card.releasePointerCapture(pointerId);
      useNoteDragState.setState({ drag: null });
      stopRef.current = null;
      // The click synthesized after pointerup must not open the source note.
      window.setTimeout(() => { suppressClick.current = false; }, 0);
    };
    const move = (pointer: PointerEvent) => {
      if (pointer.pointerId !== pointerId) return;
      x = pointer.clientX;
      y = pointer.clientY;
      if (!dragging) {
        if (Math.hypot(x - startX, y - startY) < 6) return;
        dragging = true;
        suppressClick.current = true;
        card.setPointerCapture?.(pointerId);
        frame = window.requestAnimationFrame(scroll);
      }
      pointer.preventDefault();
      update();
    };
    const up = (pointer: PointerEvent) => {
      if (pointer.pointerId !== pointerId) return;
      const folder = dragging ? folderAtPoint(pointer.clientX, pointer.clientY, path) : null;
      stop();
      const state = useAppStore.getState();
      if (folder !== null && state.workspaceRoot === workspaceRoot && !state.isLoading) {
        void state.moveNote(path, folder);
      }
    };
    const cancel = (pointer: PointerEvent) => {
      if (pointer.pointerId === pointerId) stop();
    };
    const keydown = (key: KeyboardEvent) => {
      if (key.key === "Escape") {
        key.preventDefault();
        key.stopPropagation();
        stop();
      }
    };
    stopRef.current = stop;
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("blur", stop);
    window.addEventListener("keydown", keydown, true);
  };

  return {
    onPointerDown,
    onClickCapture: (event: React.MouseEvent<HTMLElement>) => {
      if (!suppressClick.current) return;
      event.preventDefault();
      event.stopPropagation();
    },
    onDragStart: (event: React.DragEvent<HTMLElement>) => {
      if ((event.target as Element).closest("[data-note-card]")) event.preventDefault();
    },
  };
}

export function NoteDragPreview() {
  const drag = useNoteDragState((state) => state.drag);
  if (!drag) return null;
  return createPortal(
    <div
      aria-hidden="true"
      data-note-drag-preview=""
      {...stylex.props(noteListStyles.dragPreview, noteListStyles.dragPosition(drag.x + 14, drag.y + 14))}
    >
      {drag.label}
    </div>,
    document.body,
  );
}
