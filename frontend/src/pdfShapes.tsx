import type { CSSProperties } from "react";

export type PdfShapeKind = "rectangle" | "ellipse" | "line" | "arrow" | "highlight" | "freehand";
export type PdfDrawingTool = "select" | PdfShapeKind | "filled-rectangle" | "square" | "filled-square" | "circle";
export type ShapePoint = [number, number];
export type ShapeGeometry = {
  xMm: number;
  yMm: number;
  widthMm: number;
  heightMm: number;
  flipX: boolean;
  flipY: boolean;
  points: ShapePoint[];
};

export function shapeGeometry(start: ShapePoint, end: ShapePoint, trail: ShapePoint[] = []): ShapeGeometry {
  const all = trail.length > 1 ? trail : [start, end];
  const left = Math.min(...all.map(p => p[0]));
  const top = Math.min(...all.map(p => p[1]));
  const right = Math.max(...all.map(p => p[0]));
  const bottom = Math.max(...all.map(p => p[1]));
  const width = Math.max(0.2, right - left);
  const height = Math.max(0.2, bottom - top);
  return {
    xMm: left,
    yMm: top,
    widthMm: width,
    heightMm: height,
    flipX: start[0] > end[0],
    flipY: start[1] > end[1],
    points: trail.length > 1 ? trail.map(([x, y]) => [
      Math.max(0, Math.min(1, (x - left) / width)),
      Math.max(0, Math.min(1, (y - top) / height)),
    ] as ShapePoint) : [],
  };
}

export const PDF_SHAPE_TOOLS: { tool: PdfDrawingTool; label: string; symbol: string }[] = [
  { tool: "select", label: "تحديد", symbol: "↖" },
  { tool: "square", label: "مربع", symbol: "□" },
  { tool: "filled-square", label: "مربع مظلل", symbol: "▣" },
  { tool: "rectangle", label: "مستطيل", symbol: "▭" },
  { tool: "filled-rectangle", label: "مستطيل مظلل", symbol: "▰" },
  { tool: "circle", label: "دائرة", symbol: "◯" },
  { tool: "ellipse", label: "شكل بيضاوي", symbol: "⬭" },
  { tool: "line", label: "خط", symbol: "╱" },
  { tool: "arrow", label: "سهم", symbol: "➜" },
  { tool: "highlight", label: "تمييز شفاف", symbol: "▰" },
  { tool: "freehand", label: "قلم حر", symbol: "✎" },
];

type ShapeView = {
  shape: PdfShapeKind;
  strokeColor: string;
  fillColor: string;
  fillEnabled: boolean;
  strokeWidthPt: number;
  dashed: boolean;
  flipX: boolean;
  flipY: boolean;
  points: ShapePoint[];
};

export function PdfShapeGraphic({ item }: { item: ShapeView }) {
  const startX = item.flipX ? 100 : 0;
  const startY = item.flipY ? 100 : 0;
  const endX = item.flipX ? 0 : 100;
  const endY = item.flipY ? 0 : 100;
  const dx = endX - startX;
  const dy = endY - startY;
  const length = Math.hypot(dx, dy) || 1;
  const arrowSize = 15;
  const ux = dx / length;
  const uy = dy / length;
  const lX = endX - ux * arrowSize - uy * arrowSize * 0.55;
  const lY = endY - uy * arrowSize + ux * arrowSize * 0.55;
  const rX = endX - ux * arrowSize + uy * arrowSize * 0.55;
  const rY = endY - uy * arrowSize - ux * arrowSize * 0.55;
  const common = {
    stroke: item.shape === "highlight" ? "none" : item.strokeColor,
    strokeWidth: Math.max(1, item.strokeWidthPt * 1.3),
    strokeDasharray: item.dashed ? "8 5" : undefined,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    vectorEffect: "non-scaling-stroke" as const,
  };
  const fill = item.shape === "highlight" || item.fillEnabled ? item.fillColor : "none";
  const svgStyle: CSSProperties = { width: "100%", height: "100%", display: "block", overflow: "visible", pointerEvents: "none" };
  return (
    <svg className="pdf-shape-graphic" viewBox="0 0 100 100" preserveAspectRatio="none" style={svgStyle} aria-hidden="true">
      {item.shape === "rectangle" || item.shape === "highlight" ? (
        <rect x="0" y="0" width="100" height="100" {...common} fill={fill} />
      ) : item.shape === "ellipse" ? (
        <ellipse cx="50" cy="50" rx="50" ry="50" {...common} fill={fill} />
      ) : item.shape === "line" || item.shape === "arrow" ? (
        <>
          <line x1={startX} y1={startY} x2={endX} y2={endY} {...common} />
          {item.shape === "arrow" && <polyline points={[lX + "," + lY, endX + "," + endY, rX + "," + rY].join(" ")} {...common} fill="none" />}
        </>
      ) : (
        <polyline points={item.points.map(([x,y]) => (x*100) + "," + (y*100)).join(" ")} {...common} fill="none" />
      )}
    </svg>
  );
}
