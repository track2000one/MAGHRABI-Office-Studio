import {describe, expect, it} from "vitest";
import {clampPdfZoom, pdfCanvasWidth, pdfNextZoom, pdfVisibleZoom} from "../pdfViewerZoom";

describe("responsive PDF visual editor viewport", () => {
  it("fits the entire page width even in a narrow side-by-side layout", () => {
    expect(pdfCanvasWidth("fit-width", 100, 390, 720, 210, 297)).toBe(360);
    expect(pdfCanvasWidth("fit-width", 100, 1010, 720, 210, 297)).toBe(980);
  });
  it("fits the entire tall page without cropping it vertically", () => {
    const width = pdfCanvasWidth("fit-page", 100, 640, 520, 210, 297);
    expect(width).toBeLessThanOrEqual(610);
    expect(width / (210 / 297)).toBeLessThanOrEqual(490.5);
  });
  it("adapts to landscape PDF pages without changing source coordinates", () => {
    const width = pdfCanvasWidth("fit-page", 100, 520, 650, 297, 210);
    expect(width).toBe(490);
  });
  it("makes zoom buttons and custom slider actually change canvas dimensions", () => {
    expect(pdfCanvasWidth("custom", 100, 300, 400, 210, 297)).toBe(760);
    expect(pdfCanvasWidth("custom", 200, 300, 400, 210, 297)).toBe(1520);
    expect(pdfCanvasWidth("custom", 400, 300, 400, 210, 297)).toBe(3040);
    expect(pdfVisibleZoom(380)).toBe(50);
    expect(pdfNextZoom(380, 10)).toBe(60);
  });
  it("constrains zoom and handles invalid numerical values", () => {
    expect(clampPdfZoom(1)).toBe(20);
    expect(clampPdfZoom(900)).toBe(400);
    expect(clampPdfZoom(Number.NaN)).toBe(100);
    expect(pdfNextZoom(3040, 10)).toBe(400);
    expect(pdfNextZoom(152, -20)).toBe(20);
  });
});
