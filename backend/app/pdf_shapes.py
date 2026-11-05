"""Render individually placed PDF annotations as vector graphics (not bitmaps)."""

from __future__ import annotations

import math
import re

import pymupdf
from fastapi import HTTPException


SHAPES = {"rectangle", "ellipse", "line", "arrow", "highlight", "freehand"}
HEX = re.compile(r"#[0-9a-fA-F]{6}\Z")


def _rgb(value: object, field: str) -> tuple[float, float, float]:
    if not isinstance(value, str) or not HEX.fullmatch(value):
        raise HTTPException(422, f"لون {field} غير صالح.")
    return tuple(int(value[i:i + 2], 16) / 255 for i in (1, 3, 5))


def _number(value: object, name: str, low: float, high: float) -> float:
    try:
        result = float(value)
    except (ValueError, TypeError) as exc:
        raise HTTPException(422, f"قيمة {name} غير صالحة.") from exc
    if not math.isfinite(result) or not low <= result <= high:
        raise HTTPException(422, f"قيمة {name} خارج النطاق المسموح.")
    return result


def render_pdf_shape(page: pymupdf.Page, rect: pymupdf.Rect, element: dict) -> None:
    """Draw geometry in page coordinates; local paths are scaled to rect."""
    kind = element.get("shape")
    if kind not in SHAPES:
        raise HTTPException(422, "نوع الشكل الهندسي غير مدعوم.")
    width = _number(element.get("stroke_width_pt", 2), "سُمك الخط", 0.5, 16)
    opacity = _number(element.get("opacity", 1), "الشفافية", 0.01, 1)
    stroke = _rgb(element.get("stroke_color", "#1477ad"), "الحدود")
    fill = _rgb(element.get("fill_color", "#f5bd3c"), "التعبئة")
    filled = bool(element.get("fill_enabled", False))
    dashed = bool(element.get("dashed", False))
    flip_x = bool(element.get("flip_x", False))
    flip_y = bool(element.get("flip_y", False))
    dashes = "[4 3] 0" if dashed else None
    angle = _number(element.get("rotation", 0), "زاوية تدوير الشكل", 0, 359)
    center = pymupdf.Point((rect.x0 + rect.x1) / 2, (rect.y0 + rect.y1) / 2)
    morph = (center, pymupdf.Matrix(angle)) if angle else None

    def point(x: float, y: float) -> pymupdf.Point:
        return pymupdf.Point(rect.x0 + x * rect.width, rect.y0 + y * rect.height)

    if kind == "rectangle":
        page.draw_rect(rect, color=stroke, fill=fill if filled else None,
                       width=width, dashes=dashes, morph=morph,
                       stroke_opacity=opacity, fill_opacity=opacity, overlay=True)
    elif kind == "ellipse":
        page.draw_oval(rect, color=stroke, fill=fill if filled else None,
                      width=width, dashes=dashes, morph=morph,
                      stroke_opacity=opacity, fill_opacity=opacity, overlay=True)
    elif kind == "highlight":
        page.draw_rect(rect, color=None, fill=fill, fill_opacity=opacity,
                       morph=morph, overlay=True)
    elif kind in {"line", "arrow"}:
        start = point(1 if flip_x else 0, 1 if flip_y else 0)
        end = point(0 if flip_x else 1, 0 if flip_y else 1)
        page.draw_line(start, end, color=stroke, width=width,
                       dashes=dashes, morph=morph, stroke_opacity=opacity, overlay=True)
        if kind == "arrow":
            dx, dy = end.x - start.x, end.y - start.y
            length = math.hypot(dx, dy)
            if length > 0:
                ux, uy = dx / length, dy / length
                arrow_length = min(max(8, width * 5), length * 0.4)
                wing = arrow_length * 0.5
                left = pymupdf.Point(end.x - ux * arrow_length - uy * wing,
                                     end.y - uy * arrow_length + ux * wing)
                right = pymupdf.Point(end.x - ux * arrow_length + uy * wing,
                                      end.y - uy * arrow_length - ux * wing)
                page.draw_polyline([left, end, right], color=stroke, width=width,
                                   stroke_opacity=opacity, overlay=True)
    else:
        points = element.get("points")
        if not isinstance(points, list) or not (2 <= len(points) <= 1000):
            raise HTTPException(422, "مسار الرسم الحر غير صالح.")
        normalized = []
        for pair in points:
            if not isinstance(pair, (list, tuple)) or len(pair) != 2:
                raise HTTPException(422, "إحداثيات الرسم الحر غير صالحة.")
            x = _number(pair[0], "X", 0, 1)
            y = _number(pair[1], "Y", 0, 1)
            normalized.append(point(x, y))
        page.draw_polyline(normalized, color=stroke, width=width,
                           dashes=dashes, morph=morph, stroke_opacity=opacity, overlay=True)
