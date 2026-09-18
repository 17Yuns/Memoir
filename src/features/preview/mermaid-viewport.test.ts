import { describe, expect, it } from "vitest";
import {
  clampScale,
  fitViewport,
  MAX_SCALE,
  MIN_SCALE,
  parseSvgSize,
  pointerMoved,
  prefixMermaidSvgIds,
  panViewport,
  wheelZoomFactor,
  zoomAt,
  zoomByStep,
} from "./mermaid-viewport";

describe("mermaid viewport", () => {
  it("clamps scale to the supported range", () => {
    expect(clampScale(0)).toBe(MIN_SCALE);
    expect(clampScale(Number.POSITIVE_INFINITY)).toBe(1);
    expect(clampScale(99)).toBe(MAX_SCALE);
    expect(clampScale(1.5)).toBe(1.5);
  });

  it("zooms around the pointer so the content under the cursor stays put", () => {
    const next = zoomAt({ x: 10, y: 20, scale: 1 }, { x: 100, y: 80 }, 2);
    expect(next.scale).toBe(2);
    expect(next.x).toBe(10 - 90);
    expect(next.y).toBe(20 - 60);
  });

  it("zooms in and out by a fixed step", () => {
    const start = { x: 0, y: 0, scale: 1 };
    const zoomed = zoomByStep(start, { x: 0, y: 0 }, 1);
    expect(zoomed.scale).toBeGreaterThan(1);
    expect(zoomByStep(zoomed, { x: 0, y: 0 }, -1).scale).toBeCloseTo(1);
  });

  it("fits content inside the stage with padding", () => {
    const view = fitViewport({ width: 1000, height: 800 }, { width: 400, height: 200 }, 100);
    expect(view.scale).toBe(2);
    expect(view.x).toBe((1000 - 800) / 2);
    expect(view.y).toBe((800 - 400) / 2);
  });

  it("returns a neutral viewport when the stage has no layout", () => {
    expect(fitViewport({ width: 0, height: 0 }, { width: 400, height: 200 })).toEqual({
      x: 0,
      y: 0,
      scale: 1,
    });
  });

  it("parses mermaid viewBox and numeric width/height", () => {
    expect(parseSvgSize('<svg viewBox="0 0 456.2 78" width="100%"></svg>')).toEqual({
      width: 456.2,
      height: 78,
    });
    expect(parseSvgSize('<svg width="120px" height="40px"></svg>')).toEqual({
      width: 120,
      height: 40,
    });
    expect(parseSvgSize("<svg></svg>")).toBeNull();
  });

  it("prefixes the root mermaid svg id so the lightbox copy does not collide", () => {
    const svg =
      '<svg id="memoir-mmd-1"><style>#memoir-mmd-1{color:red}</style><marker id="memoir-mmd-1_end"></marker></svg>';
    expect(prefixMermaidSvgIds(svg, "lb-")).toBe(
      '<svg id="lb-memoir-mmd-1"><style>#lb-memoir-mmd-1{color:red}</style><marker id="lb-memoir-mmd-1_end"></marker></svg>',
    );
    expect(prefixMermaidSvgIds("<svg></svg>", "lb-")).toBe("<svg></svg>");
  });

  it("treats small pointer travel as a click", () => {
    expect(pointerMoved({ x: 0, y: 0 }, { x: 3, y: 3 })).toBe(false);
    expect(pointerMoved({ x: 0, y: 0 }, { x: 6, y: 0 })).toBe(true);
  });

  it("pans by delta and shrinks on positive wheel delta", () => {
    expect(panViewport({ x: 4, y: 8, scale: 1 }, 10, -2)).toEqual({ x: 14, y: 6, scale: 1 });
    expect(wheelZoomFactor(100)).toBeLessThan(1);
    expect(wheelZoomFactor(-100)).toBeGreaterThan(1);
  });
});
