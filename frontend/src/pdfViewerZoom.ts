/** Responsive PDF canvas sizing. Widths are CSS pixels; PDF coordinates stay in millimeters. */
export type PdfViewMode = "fit-width" | "fit-page" | "custom";
export const PDF_BASE_CANVAS_WIDTH = 760;
export const PDF_MIN_ZOOM = 20;
export const PDF_MAX_ZOOM = 400;

export function clampPdfZoom(value: number): number {
  if (!Number.isFinite(value)) return 100;
  return Math.min(PDF_MAX_ZOOM, Math.max(PDF_MIN_ZOOM, Math.round(value)));
}
export function pdfCanvasWidth(
  mode: PdfViewMode,
  zoom: number,
  viewportWidth: number,
  viewportHeight: number,
  pageWidthMm: number,
  pageHeightMm: number,
): number {
  const usableWidth = Math.max(140, viewportWidth - 30);
  const usableHeight = Math.max(160, viewportHeight - 30);
  const ratio = pageWidthMm > 0 && pageHeightMm > 0 ? pageWidthMm / pageHeightMm : 1;
  if (mode === "fit-width") return Math.round(usableWidth);
  if (mode === "fit-page") return Math.round(Math.min(usableWidth, usableHeight * ratio));
  return Math.round(PDF_BASE_CANVAS_WIDTH * clampPdfZoom(zoom) / 100);
}

export function pdfVisibleZoom(canvasWidth: number): number {
  return Math.round(canvasWidth / PDF_BASE_CANVAS_WIDTH * 100);
}

export function pdfNextZoom(currentWidth: number, increment: number): number {
  return clampPdfZoom(pdfVisibleZoom(currentWidth) + increment);
}
