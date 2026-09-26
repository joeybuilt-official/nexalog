// SPDX-License-Identifier: MIT
/**
 * Canvas geometry + viewport math for the Knowledge-Garden SVG (pure, tested).
 *
 * The radial layout is deterministic and is deliberately NOT recomputed when
 * the reader filters — nodes keep their coordinates so nobody loses their
 * bearings. What moves instead is the `viewBox` window: "focus a node" is a
 * viewport centred on that node at a readable zoom, nothing more.
 *
 * Kept out of the component so the arithmetic is unit-testable and the canvas
 * element stays a renderer.
 */

/** The canvas the radial layout is computed in (also the default viewBox). */
export const CANVAS_WIDTH = 860;
export const CANVAS_HEIGHT = 620;
export const CANVAS_CENTER_X = CANVAS_WIDTH / 2;
export const CANVAS_CENTER_Y = CANVAS_HEIGHT / 2;

/** Zoom applied when the reader focuses a node; > 1 magnifies. */
export const FOCUS_ZOOM = 1.9;

export interface GraphViewport {
  cx: number;
  cy: number;
  zoom: number;
}

export const BASE_VIEWPORT: GraphViewport = {
  cx: CANVAS_CENTER_X,
  cy: CANVAS_CENTER_Y,
  zoom: 1,
};

/** Clamp a zoom factor into a range that keeps the canvas legible. */
export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return 1;
  return Math.min(4, Math.max(0.5, zoom));
}

/** A viewport centred on (x, y). Used to centre/focus a chosen node. */
export function focusViewport(x: number, y: number, zoom: number = FOCUS_ZOOM): GraphViewport {
  return {
    cx: Number.isFinite(x) ? x : CANVAS_CENTER_X,
    cy: Number.isFinite(y) ? y : CANVAS_CENTER_Y,
    zoom: clampZoom(zoom),
  };
}

/** The `viewBox` attribute for a viewport — width/height shrink as zoom rises. */
export function viewBoxFor(
  viewport: GraphViewport,
  width: number = CANVAS_WIDTH,
  height: number = CANVAS_HEIGHT,
): string {
  const zoom = clampZoom(viewport.zoom);
  const w = width / zoom;
  const h = height / zoom;
  return `${viewport.cx - w / 2} ${viewport.cy - h / 2} ${w} ${h}`;
}

/** True when the viewport is the unzoomed, centred default. */
export function isBaseViewport(viewport: GraphViewport): boolean {
  return (
    viewport.cx === BASE_VIEWPORT.cx &&
    viewport.cy === BASE_VIEWPORT.cy &&
    viewport.zoom === BASE_VIEWPORT.zoom
  );
}
