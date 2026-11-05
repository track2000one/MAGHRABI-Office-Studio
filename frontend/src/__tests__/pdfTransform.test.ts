import {describe, it, expect} from "vitest";
import {rotatedBounds, unionBounds, snapSelectionMove, alignSelection} from "../pdfTransform";
const page = {width_mm: 210, height_mm: 297};
const box = {xMm: 10, yMm: 20, widthMm: 40, heightMm: 20, rotation: 0};
describe("PDF multi-select transforms", () => {
  it("computes clockwise rotation bounds around a fixed center", () => {
    const unrotated = rotatedBounds(box);
    expect(unrotated).toEqual({left: 10, top: 20, right: 50, bottom: 40});
    const rotated = rotatedBounds({...box, rotation: 90});
    expect(rotated.left).toBeCloseTo(20);
    expect(rotated.right).toBeCloseTo(40);
    expect(rotated.top).toBeCloseTo(10);
    expect(rotated.bottom).toBeCloseTo(50);
  });
  it("uses all selected boxes when aligning a group to the page", () => {
    const a = box;
    const b = {...box, xMm: 70, yMm: 60};
    const u = unionBounds([a, b]);
    expect(u).toEqual({left: 10, top: 20, right: 110, bottom: 80});
    const move = alignSelection([a, b], page, "center-x");
    expect(move).toEqual({dx: 45, dy: 0});
    expect((a.xMm + move.dx) - (b.xMm + move.dx)).toBe(-60);
  });
  it("snaps group to a neighbor without moving items individually", () => {
    const other = {...box, xMm: 80};
    const snapped = snapSelectionMove([box], [other], page, 29, 0);
    expect(snapped.dx).toBe(30); // right edge 50 + 30 == left edge 80
    expect(snapped.guideX).toBe(80);
  });
  it("snaps to page edges and clamps rotated selections inside the page", () => {
    const edge = snapSelectionMove([box], [], page, -9, 0);
    expect(edge.dx).toBe(-10);
    expect(edge.guideX).toBe(0);
    const rotated = {...box, rotation: 45};
    const clamped = snapSelectionMove([rotated], [], page, -100, -100);
    const future = rotatedBounds({...rotated, xMm: rotated.xMm + clamped.dx,
      yMm: rotated.yMm + clamped.dy});
    expect(future.left).toBeGreaterThanOrEqual(-1e-7);
    expect(future.top).toBeGreaterThanOrEqual(-1e-7);
  });
  it("uses page-space coordinates that are independent of UI zoom", () => {
    const leftAligned = alignSelection([box], page, "left");
    const centered = alignSelection([box], page, "center-y");
    expect(leftAligned.dx).toBe(-10);
    expect(centered.dy).toBeCloseTo((297-20)/2-20);
  });
});
