import * as stylex from "@stylexjs/stylex";
import { Maximize2, X, ZoomIn, ZoomOut } from "lucide-react";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { createPortal } from "react-dom";
import { IconButton } from "../../components/ui";
import { usePresence } from "../../components/ui/usePresence";
import { useI18n } from "../../i18n/react";
import { colors, layout, motion, typography } from "../../styles/tokens.stylex";
import {
  fitViewport,
  panViewport,
  parseSvgSize,
  pointerMoved,
  prefixMermaidSvgIds,
  stageCenter,
  type Size,
  type Viewport,
  wheelZoomFactor,
  zoomAt,
  zoomByStep,
} from "./mermaid-viewport";

const FALLBACK_SIZE: Size = { width: 800, height: 450 };
const FOCUSABLE_SELECTOR =
  "button:not([disabled]), [href], [tabindex]:not([tabindex='-1'])";

type DragState = {
  pointerId: number;
  x: number;
  y: number;
  originX: number;
  originY: number;
  moved: boolean;
};

export function MermaidLightbox({
  open,
  svg,
  onClose,
}: {
  open: boolean;
  svg: string;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const { present, visible } = usePresence(open);
  const overlayRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<Viewport>({ x: 0, y: 0, scale: 1 });
  const stageSizeRef = useRef<Size>({ width: 0, height: 0 });
  const dragRef = useRef<DragState | null>(null);
  const [view, setView] = useState<Viewport>({ x: 0, y: 0, scale: 1 });
  const [dragging, setDragging] = useState(false);
  const content = parseSvgSize(svg) ?? FALLBACK_SIZE;
  const lightboxSvg = prefixMermaidSvgIds(svg, "lb-");

  const commit = (next: Viewport) => {
    viewRef.current = next;
    setView(next);
  };

  const fitToStage = () => {
    commit(fitViewport(stageSizeRef.current, content));
  };

  useLayoutEffect(() => {
    if (!present) return;
    const stage = stageRef.current;
    if (!stage) return;
    const measure = () => {
      const rect = stage.getBoundingClientRect();
      stageSizeRef.current = { width: rect.width, height: rect.height };
    };
    measure();
    const next = fitViewport(stageSizeRef.current, parseSvgSize(svg) ?? FALLBACK_SIZE);
    viewRef.current = next;
    setView(next);
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    return () => observer.disconnect();
  }, [present, svg]);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        commit(zoomByStep(viewRef.current, stageCenter(stageSizeRef.current), 1));
        return;
      }
      if (event.key === "-" || event.key === "_") {
        event.preventDefault();
        commit(zoomByStep(viewRef.current, stageCenter(stageSizeRef.current), -1));
        return;
      }
      if (event.key === "0") {
        event.preventDefault();
        commit(fitViewport(stageSizeRef.current, parseSvgSize(svg) ?? FALLBACK_SIZE));
        return;
      }
      if (event.key !== "Tab") return;
      const overlay = overlayRef.current;
      if (!overlay) return;
      const elements = [...overlay.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)];
      if (!elements.length) return;
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previous?.focus();
    };
  }, [onClose, open, svg]);

  useEffect(() => {
    if (!open) return;
    const overlay = overlayRef.current;
    if (!overlay) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const stage = stageRef.current;
      if (!stage) return;
      const rect = stage.getBoundingClientRect();
      commit(
        zoomAt(
          viewRef.current,
          { x: event.clientX - rect.left, y: event.clientY - rect.top },
          wheelZoomFactor(event.deltaY),
        ),
      );
    };
    overlay.addEventListener("wheel", onWheel, { passive: false });
    return () => overlay.removeEventListener("wheel", onWheel);
  }, [open]);

  if (!present) return null;

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button > 0) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      originX: viewRef.current.x,
      originY: viewRef.current.y,
      moved: false,
    };
    setDragging(true);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const next = { x: event.clientX, y: event.clientY };
    if (!drag.moved && pointerMoved({ x: drag.x, y: drag.y }, next)) {
      drag.moved = true;
    }
    commit(panViewport(
      { x: drag.originX, y: drag.originY, scale: viewRef.current.scale },
      next.x - drag.x,
      next.y - drag.y,
    ));
  };

  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    }
    if (!drag.moved && event.target === event.currentTarget) onClose();
  };

  return createPortal(
    <div
      {...stylex.props(styles.overlay, visible && styles.visible)}
      data-mermaid-lightbox=""
      data-state={visible ? "open" : "closed"}
      ref={overlayRef}
      role="presentation"
    >
      <div
        aria-label={t("preview.mermaidPreview")}
        aria-modal="true"
        data-state={visible ? "open" : "closed"}
        role="dialog"
        {...stylex.props(styles.frame, visible && styles.visible)}
      >
        <div
          aria-label={t("preview.mermaidHint")}
          data-dragging={dragging ? "" : undefined}
          data-mermaid-stage=""
          onDoubleClick={(event) => {
            event.preventDefault();
            fitToStage();
          }}
          onPointerCancel={endDrag}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          ref={stageRef}
          {...stylex.props(styles.stage, dragging && styles.stageDragging)}
        >
          <div
            data-mermaid-canvas=""
            data-scale={String(view.scale)}
            data-x={String(view.x)}
            data-y={String(view.y)}
            dangerouslySetInnerHTML={{ __html: lightboxSvg }}
            {...stylex.props(
              styles.canvas,
              styles.canvasSize(content.width, content.height),
              styles.canvasTransform(view.x, view.y, view.scale),
            )}
          />
        </div>
        <div role="toolbar" {...stylex.props(styles.toolbar)}>
          <IconButton
            label={t("preview.zoomOut")}
            onClick={() => commit(zoomByStep(viewRef.current, stageCenter(stageSizeRef.current), -1))}
          >
            <ZoomOut {...stylex.props(styles.icon)} strokeWidth={1.8} />
          </IconButton>
          <span aria-live="polite" {...stylex.props(styles.scaleLabel)}>
            {Math.round(view.scale * 100)}%
          </span>
          <IconButton
            label={t("preview.zoomIn")}
            onClick={() => commit(zoomByStep(viewRef.current, stageCenter(stageSizeRef.current), 1))}
          >
            <ZoomIn {...stylex.props(styles.icon)} strokeWidth={1.8} />
          </IconButton>
          <IconButton label={t("preview.fitMermaid")} onClick={fitToStage}>
            <Maximize2 {...stylex.props(styles.icon)} strokeWidth={1.8} />
          </IconButton>
        </div>
        <IconButton autoFocus label={t("common.close")} onClick={onClose} style={styles.close}>
          <X {...stylex.props(styles.icon)} strokeWidth={1.8} />
        </IconButton>
      </div>
    </div>,
    document.body,
  );
}

const styles = stylex.create({
  overlay: {
    position: "fixed",
    inset: layout.windowInset,
    zIndex: 50,
    display: "grid",
    overflow: "clip",
    overscrollBehavior: "contain",
    backgroundColor: `color-mix(in srgb, ${colors.text} 42%, transparent)`,
    backdropFilter: "blur(10px)",
    borderRadius: {
      default: "16px",
      ':is([data-window-frame="native"] *)': "10px",
      ':is([data-window-frame="flush"] *)': 0,
      ':is([data-maximized="true"] *)': 0,
      "@media (max-width: 760px)": 0,
    },
    opacity: {
      default: 0,
      "@media (prefers-reduced-motion: reduce)": 1,
    },
    transitionProperty: "opacity",
    transitionDuration: {
      default: motion.standard,
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    transitionTimingFunction: motion.ease,
  },
  frame: {
    position: "relative",
    width: "100%",
    height: "100%",
    minWidth: 0,
    minHeight: 0,
    overflow: "hidden",
    opacity: {
      default: 0,
      "@media (prefers-reduced-motion: reduce)": 1,
    },
    transform: {
      default: "scale(0.985)",
      "@media (prefers-reduced-motion: reduce)": "none",
    },
    transitionProperty: "opacity, transform",
    transitionDuration: {
      default: motion.standard,
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    transitionTimingFunction: motion.ease,
  },
  visible: {
    opacity: 1,
    transform: "none",
  },
  stage: {
    position: "absolute",
    inset: 0,
    minWidth: 0,
    minHeight: 0,
    overflow: "hidden",
    cursor: "grab",
    touchAction: "none",
    userSelect: "none",
  },
  stageDragging: {
    cursor: "grabbing",
  },
  canvas: {
    transformOrigin: "0 0",
    willChange: "transform",
  },
  canvasSize: (width: number, height: number) => ({
    width,
    height,
  }),
  canvasTransform: (x: number, y: number, scale: number) => ({
    transform: `translate(${x}px, ${y}px) scale(${scale})`,
  }),
  toolbar: {
    position: "absolute",
    zIndex: 1,
    bottom: 20,
    left: "50%",
    display: "flex",
    alignItems: "center",
    gap: 4,
    padding: 4,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: `color-mix(in srgb, ${colors.border} 86%, transparent)`,
    borderRadius: 12,
    backgroundColor: `color-mix(in srgb, ${colors.elevated} 92%, transparent)`,
    boxShadow: "0 10px 28px rgb(37 33 27 / 16%)",
    transform: "translateX(-50%)",
  },
  scaleLabel: {
    minWidth: 48,
    color: colors.text,
    fontFamily: typography.uiFont,
    fontSize: 12,
    fontVariantNumeric: "tabular-nums",
    fontWeight: 600,
    textAlign: "center",
  },
  close: {
    position: "absolute",
    zIndex: 1,
    top: 16,
    right: 16,
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: `color-mix(in srgb, ${colors.elevated} 88%, transparent)`,
    boxShadow: "0 8px 20px rgb(37 33 27 / 12%)",
  },
  icon: {
    width: 16,
    height: 16,
  },
});
