export interface PanOffset {
  tx: number;
  ty: number;
}

/** Compute scale that fits an image cleanly inside a viewport container without upscaling above 1. */
export function computeFitScale(
  viewportW: number,
  viewportH: number,
  naturalW: number,
  naturalH: number,
): number {
  if (viewportW <= 0 || viewportH <= 0 || naturalW <= 0 || naturalH <= 0) {
    return 1;
  }
  return Math.min(viewportW / naturalW, viewportH / naturalH, 1);
}

/** Clamp scale between minScale and maxScale (default 3.0 = 300%). */
export function clampScale(scale: number, minScale: number, maxScale = 3): number {
  const safeMin = Math.max(0.05, Math.min(minScale, maxScale));
  if (!Number.isFinite(scale)) {
    return safeMin;
  }
  return Math.min(maxScale, Math.max(safeMin, scale));
}

/**
 * Clamp pan translation so zoomed images stay anchored within viewport boundaries
 * and smaller-than-viewport images stay centered.
 */
export function clampPan(
  tx: number,
  ty: number,
  scale: number,
  viewportW: number,
  viewportH: number,
  naturalW: number,
  naturalH: number,
): PanOffset {
  if (viewportW <= 0 || viewportH <= 0 || naturalW <= 0 || naturalH <= 0) {
    return { tx: 0, ty: 0 };
  }

  const scaledW = naturalW * scale;
  const scaledH = naturalH * scale;

  const clampedX =
    scaledW <= viewportW
      ? (viewportW - scaledW) / 2
      : Math.min(0, Math.max(viewportW - scaledW, tx));

  const clampedY =
    scaledH <= viewportH
      ? (viewportH - scaledH) / 2
      : Math.min(0, Math.max(viewportH - scaledH, ty));

  return { tx: clampedX, ty: clampedY };
}

/** Zoom toward a viewport focal point (originX, originY) while keeping that pixel anchored. */
export function zoomAroundPoint(
  currentScale: number,
  nextScale: number,
  currentTx: number,
  currentTy: number,
  originX: number,
  originY: number,
): PanOffset {
  if (currentScale <= 0) {
    return { tx: currentTx, ty: currentTy };
  }
  const ratio = nextScale / currentScale;
  return {
    tx: originX - (originX - currentTx) * ratio,
    ty: originY - (originY - currentTy) * ratio,
  };
}
