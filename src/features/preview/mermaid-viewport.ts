export const MIN_SCALE = 0.15;
export const MAX_SCALE = 12;
export const ZOOM_STEP = 1.25;
export const WHEEL_ZOOM_SENSITIVITY = 0.0016;
export const POINTER_CLICK_PX = 5;

export type Size = { width: number; height: number };
export type Point = { x: number; y: number };
export type Viewport = { x: number; y: number; scale: number };

export function clampScale(scale: number) {
  if (!Number.isFinite(scale)) return 1;
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

export function panViewport(view: Viewport, dx: number, dy: number): Viewport {
  return { ...view, x: view.x + dx, y: view.y + dy };
}

export function zoomAt(view: Viewport, pointer: Point, factor: number): Viewport {
  const nextScale = clampScale(view.scale * factor);
  if (nextScale === view.scale || view.scale === 0) return view;
  const ratio = nextScale / view.scale;
  return {
    scale: nextScale,
    x: pointer.x - (pointer.x - view.x) * ratio,
    y: pointer.y - (pointer.y - view.y) * ratio,
  };
}

export function zoomByStep(view: Viewport, center: Point, direction: 1 | -1): Viewport {
  return zoomAt(view, center, direction > 0 ? ZOOM_STEP : 1 / ZOOM_STEP);
}

export function wheelZoomFactor(deltaY: number) {
  return Math.exp(-deltaY * WHEEL_ZOOM_SENSITIVITY);
}

export function stageCenter(stage: Size): Point {
  return { x: stage.width / 2, y: stage.height / 2 };
}

export function fitViewport(stage: Size, content: Size, padding = 56): Viewport {
  if (stage.width < 8 || stage.height < 8 || content.width < 1 || content.height < 1) {
    return { x: 0, y: 0, scale: 1 };
  }
  const availW = Math.max(stage.width - padding * 2, 8);
  const availH = Math.max(stage.height - padding * 2, 8);
  const scale = clampScale(Math.min(availW / content.width, availH / content.height));
  return {
    scale,
    x: (stage.width - content.width * scale) / 2,
    y: (stage.height - content.height * scale) / 2,
  };
}

export function parseSvgSize(svg: string): Size | null {
  const viewBox = /\bviewBox\s*=\s*"([^"]+)"/i.exec(svg) || /\bviewBox\s*=\s*'([^']+)'/i.exec(svg);
  if (viewBox) {
    const parts = viewBox[1].trim().split(/[\s,]+/).map(Number);
    if (parts.length === 4 && parts.every(Number.isFinite) && parts[2] > 0 && parts[3] > 0) {
      return { width: parts[2], height: parts[3] };
    }
  }
  const widthAttr = /\bwidth\s*=\s*"([\d.]+)(?:px)?"/i.exec(svg);
  const heightAttr = /\bheight\s*=\s*"([\d.]+)(?:px)?"/i.exec(svg);
  if (widthAttr && heightAttr) {
    const width = Number(widthAttr[1]);
    const height = Number(heightAttr[1]);
    if (width > 0 && height > 0) return { width, height };
  }
  return null;
}

export function prefixMermaidSvgIds(svg: string, prefix: string) {
  if (!prefix) return svg;
  const match = /<svg\b[^>]*\bid="([^"]+)"/i.exec(svg);
  if (!match) return svg;
  const id = match[1];
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return svg.replace(new RegExp(escaped, "g"), `${prefix}${id}`);
}

export function pointerMoved(from: Point, to: Point, threshold = POINTER_CLICK_PX) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  return dx * dx + dy * dy > threshold * threshold;
}
