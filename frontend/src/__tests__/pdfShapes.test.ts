import {describe, expect, it} from "vitest";
import {PDF_SHAPE_TOOLS, shapeGeometry} from "../pdfShapes";

describe("PDF vector drawing geometry", () => {
  it("includes selection and all requested drawing tools", () => {
    expect(PDF_SHAPE_TOOLS.map(item => item.tool)).toEqual([
      "select", "square", "filled-square", "rectangle", "filled-rectangle",
      "circle", "ellipse", "line", "arrow", "highlight", "freehand",
    ]);
  });

  it("normalizes reverse drag direction without losing arrow orientation", () => {
    const geometry = shapeGeometry([140, 90], [60, 30]);
    expect(geometry.xMm).toBe(60);
    expect(geometry.yMm).toBe(30);
    expect(geometry.widthMm).toBe(80);
    expect(geometry.heightMm).toBe(60);
    expect(geometry.flipX).toBe(true);
    expect(geometry.flipY).toBe(true);
  });

  it("keeps independent per-shape freehand coordinates in a normalized box", () => {
    const geometry = shapeGeometry([20, 10], [70, 50], [
      [20, 10], [45, 40], [70, 50],
    ]);
    expect(geometry.points).toEqual([[0, 0], [0.5, 0.75], [1, 1]]);
    expect(geometry.xMm).toBe(20);
    expect(geometry.heightMm).toBe(40);
  });

  it("avoids zero-sized vector boxes on horizontal or vertical strokes", () => {
    const horizontal = shapeGeometry([10, 20], [110, 20]);
    expect(horizontal.heightMm).toBeGreaterThan(0);
    expect(horizontal.widthMm).toBe(100);
    const vertical = shapeGeometry([10, 20], [10, 120]);
    expect(vertical.widthMm).toBeGreaterThan(0);
    expect(vertical.heightMm).toBe(100);
  });
});
