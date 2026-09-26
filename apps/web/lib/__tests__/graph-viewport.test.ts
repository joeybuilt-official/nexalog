// SPDX-License-Identifier: MIT
// Garden polish: focus centring + viewBox math (pure logic).
import { describe, it, expect } from "vitest";

import {
  BASE_VIEWPORT,
  CANVAS_CENTER_X,
  CANVAS_CENTER_Y,
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  FOCUS_ZOOM,
  clampZoom,
  focusViewport,
  isBaseViewport,
  viewBoxFor,
} from "@/lib/graph/viewport";

describe("clampZoom", () => {
  it("clamps into the legible range", () => {
    expect(clampZoom(0.1)).toBe(0.5);
    expect(clampZoom(99)).toBe(4);
    expect(clampZoom(2)).toBe(2);
  });

  it("falls back to 1 for non-finite input", () => {
    expect(clampZoom(Number.NaN)).toBe(1);
    expect(clampZoom(Number.POSITIVE_INFINITY)).toBe(1);
    expect(clampZoom(Number.NEGATIVE_INFINITY)).toBe(1);
  });
});

describe("focusViewport", () => {
  it("centres on the node and zooms in", () => {
    expect(focusViewport(120, 300)).toEqual({ cx: 120, cy: 300, zoom: FOCUS_ZOOM });
  });

  it("falls back to the canvas centre for non-finite coordinates", () => {
    expect(focusViewport(Number.NaN, Number.NaN)).toEqual({
      cx: CANVAS_CENTER_X,
      cy: CANVAS_CENTER_Y,
      zoom: FOCUS_ZOOM,
    });
  });
});

describe("viewBoxFor", () => {
  it("is the full canvas at the base viewport", () => {
    expect(viewBoxFor(BASE_VIEWPORT)).toBe(`0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT}`);
  });

  it("shrinks the window as zoom rises, staying centred on the focus point", () => {
    const box = viewBoxFor({ cx: 100, cy: 200, zoom: 2 });
    expect(box).toBe(`-115 45 ${CANVAS_WIDTH / 2} ${CANVAS_HEIGHT / 2}`);
  });

  it("keeps the focused point at the centre of the window", () => {
    const [x, y, w, h] = viewBoxFor(focusViewport(300, 400)).split(" ").map(Number);
    expect(x + w / 2).toBeCloseTo(300, 6);
    expect(y + h / 2).toBeCloseTo(400, 6);
  });
});

describe("isBaseViewport", () => {
  it("detects the default state so the UI can offer a reset", () => {
    expect(isBaseViewport(BASE_VIEWPORT)).toBe(true);
    expect(isBaseViewport(focusViewport(1, 1))).toBe(false);
    expect(isBaseViewport({ cx: CANVAS_CENTER_X, cy: CANVAS_CENTER_Y, zoom: 2 })).toBe(false);
  });
});
