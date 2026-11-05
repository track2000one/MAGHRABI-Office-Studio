/** Geometry for PDF page items. All dimensions and guide tolerances are mm. */
export type PdfBox = {
  xMm: number; yMm: number; widthMm: number; heightMm: number;
  rotation: number;
};
export type Bounds = {left:number; top:number; right:number; bottom:number};
export type SnapResult = {dx:number; dy:number; guideX:number|null; guideY:number|null};
export type PageSize = {width_mm:number; height_mm:number};

export function rotatedBounds(item: PdfBox): Bounds {
  const angle = (item.rotation || 0) * Math.PI / 180;
  const halfWidth = (Math.abs(Math.cos(angle)) * item.widthMm +
    Math.abs(Math.sin(angle)) * item.heightMm) / 2;
  const halfHeight = (Math.abs(Math.sin(angle)) * item.widthMm +
    Math.abs(Math.cos(angle)) * item.heightMm) / 2;
  const centerX = item.xMm + item.widthMm / 2;
  const centerY = item.yMm + item.heightMm / 2;
  return {
    left: centerX - halfWidth, right: centerX + halfWidth,
    top: centerY - halfHeight, bottom: centerY + halfHeight,
  };
}
export function unionBounds(items: PdfBox[]): Bounds {
  if (!items.length) return {left:0, top:0, right:0, bottom:0};
  return items.map(rotatedBounds).reduce((all, box) => ({
    left: Math.min(all.left, box.left),
    top: Math.min(all.top, box.top),
    right: Math.max(all.right, box.right),
    bottom: Math.max(all.bottom, box.bottom),
  }));
}

function snappedAxis(
  start: number, end: number, delta: number, guides: number[], tolerance: number,
): {delta:number; guide:number|null} {
  const proposed = [start + delta, (start + end)/2 + delta, end + delta];
  let best: {delta:number; guide:number|null; distance:number} =
    {delta, guide:null, distance:tolerance + 1};
  for (const target of guides) {
    for (const coordinate of proposed) {
      const distance = Math.abs(target - coordinate);
      if (distance <= tolerance && distance < best.distance)
        best = {delta:delta + target - coordinate, guide:target, distance};
    }
  }
  return {delta:best.delta, guide:best.guide};
}

/** Smart page/neighbor snapping with shared rigid translation for selected items. */
export function snapSelectionMove(
  moving: PdfBox[], neighbors: PdfBox[], page: PageSize,
  dx: number, dy: number, tolerance = 2,
): SnapResult {
  if (!moving.length || !Number.isFinite(dx) || !Number.isFinite(dy))
    return {dx:0,dy:0,guideX:null,guideY:null};
  const b = unionBounds(moving);
  const xGuides = [0, page.width_mm/2, page.width_mm];
  const yGuides = [0, page.height_mm/2, page.height_mm];
  for (const neighbor of neighbors) {
    const n = rotatedBounds(neighbor);
    xGuides.push(n.left,(n.left+n.right)/2,n.right);
    yGuides.push(n.top,(n.top+n.bottom)/2,n.bottom);
  }
  const x = snappedAxis(b.left,b.right,dx,xGuides,tolerance);
  const y = snappedAxis(b.top,b.bottom,dy,yGuides,tolerance);
  const minDx = -b.left, maxDx = page.width_mm - b.right;
  const minDy = -b.top, maxDy = page.height_mm - b.bottom;
  const finalX = maxDx >= minDx ? Math.min(maxDx,Math.max(minDx,x.delta)) : 0;
  const finalY = maxDy >= minDy ? Math.min(maxDy,Math.max(minDy,y.delta)) : 0;
  return {
    dx: finalX, dy: finalY,
    guideX: Math.abs(finalX-x.delta) < 0.0001 ? x.guide:null,
    guideY: Math.abs(finalY-y.delta) < 0.0001 ? y.guide:null,
  };
}

export type Alignment = "left"|"center-x"|"right"|"top"|"center-y"|"bottom";
/** Move the entire selection as one unit, keeping relative offsets unchanged. */
export function alignSelection(
  items: PdfBox[], page: PageSize, mode: Alignment,
): {dx:number;dy:number} {
  const b = unionBounds(items);
  const width = b.right-b.left;
  const height = b.bottom-b.top;
  switch(mode) {
    case "left": return {dx:-b.left,dy:0};
    case "right": return {dx:page.width_mm-b.right,dy:0};
    case "center-x":return {dx:(page.width_mm-width)/2-b.left,dy:0};
    case "top":return {dx:0,dy:-b.top};
    case "bottom":return {dx:0,dy:page.height_mm-b.bottom};
    case "center-y":return {dx:0,dy:(page.height_mm-height)/2-b.top};
  }
}
