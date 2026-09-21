import { useLayoutEffect, useRef, useState } from "react";

export type SpeechAnchor = { left: number; right: number; top: number; bottom: number };

/** Prefer below the insertion point; flip above it when approaching the window edge. */
export function positionSpeechPanel(anchor: SpeechAnchor, width: number, height: number, viewportWidth: number, viewportHeight: number) {
  const margin = 12;
  const gap = 10;
  const maxLeft = Math.max(margin, viewportWidth - width - margin);
  const maxTop = Math.max(margin, viewportHeight - height - margin);
  const below = anchor.bottom + gap;
  const above = anchor.top - height - gap;
  return {
    left: Math.max(margin, Math.min(anchor.left, maxLeft)),
    top: Math.max(margin, Math.min(below <= maxTop ? below : above >= margin ? above : below, maxTop)),
  };
}

export function useSpeechPosition(getAnchor: () => SpeechAnchor | null, anchorElement?: HTMLElement | null) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 12, top: 12 });
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const update = () => {
      const anchor = getAnchor();
      if (!anchor) return;
      const bounds = panel.getBoundingClientRect();
      const next = positionSpeechPanel(anchor, bounds.width, bounds.height, window.innerWidth, window.innerHeight);
      setPosition((previous) => previous.left === next.left && previous.top === next.top ? previous : next);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(panel);
    if (anchorElement) observer.observe(anchorElement);
    window.addEventListener("resize", update);
    document.addEventListener("scroll", update, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
      document.removeEventListener("scroll", update, true);
    };
  }, [getAnchor, anchorElement]);
  return { panelRef, position };
}
