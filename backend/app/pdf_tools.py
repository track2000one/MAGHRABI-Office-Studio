from __future__ import annotations

from html import escape
from io import BytesIO
import re

import pymupdf
from fastapi import HTTPException

MM_TO_PT = 72 / 25.4

PAGE_SIZES_MM: dict[str, tuple[float, float]] = {
    "A0": (841, 1189),
    "A1": (594, 841),
    "A2": (420, 594),
    "A3": (297, 420),
    "A4": (210, 297),
    "A5": (148, 210),
    "A6": (105, 148),
    "B4": (250, 353),
    "B5": (176, 250),
    "LETTER": (215.9, 279.4),
    "LEGAL": (215.9, 355.6),
    "TABLOID": (279.4, 431.8),
    "EXECUTIVE": (184.15, 266.7),
}

MAX_PDF_UPLOAD = 30 * 1024 * 1024


def mm_to_pt(value: float) -> float:
    return value * MM_TO_PT


def pt_to_mm(value: float) -> float:
    return value / MM_TO_PT


def open_pdf(data: bytes) -> pymupdf.Document:
    if not data:
        raise HTTPException(400, "ملف PDF فارغ.")
    if len(data) > MAX_PDF_UPLOAD:
        raise HTTPException(413, "حجم ملف PDF يتجاوز 30 ميجابايت.")
    try:
        doc = pymupdf.open(stream=data, filetype="pdf")
    except Exception as exc:
        raise HTTPException(422, "تعذر قراءة ملف PDF. تأكد من أن الملف صالح.") from exc
    if doc.needs_pass:
        doc.close()
        raise HTTPException(422, "ملفات PDF المحمية بكلمة مرور غير مدعومة حاليًا.")
    if doc.page_count < 1:
        doc.close()
        raise HTTPException(422, "ملف PDF لا يحتوي على صفحات.")
    return doc


def parse_page_spec(
    spec: str | None,
    page_count: int,
    *,
    default_all: bool = True,
    allow_duplicates: bool = False,
) -> list[int]:
    raw = (spec or "").strip().lower()
    if not raw or raw == "all":
        return list(range(1, page_count + 1)) if default_all else []

    pages: list[int] = []
    for token in re.split(r"[,s;]+", raw):
        if not token:
            continue
        if "-" in token:
            parts = token.split("-", 1)
            if len(parts) != 2 or not parts[0].isdigit() or not parts[1].isdigit():
                raise HTTPException(422, f"صيغة نطاق الصفحات غير صحيحة: {token}")
            start, end = int(parts[0]), int(parts[1])
            step = 1 if end >= start else -1
            pages.extend(range(start, end + step, step))
        elif token.isdigit():
            pages.append(int(token))
        else:
            raise HTTPException(422, f"رقم صفحة غير صالح: {token}")

    if not pages:
        raise HTTPException(422, "حدد صفحة واحدة على الأقل.")
    if any(page < 1 or page > page_count for page in pages):
        raise HTTPException(422, f"أرقام الصفحات يجب أن تكون بين 1 و{page_count}.")
    if not allow_duplicates and len(set(pages)) != len(pages):
        raise HTTPException(422, "لا تكرر رقم الصفحة في هذا الحقل.")
    return pages


def analyze_pdf(data: bytes, filename: str) -> dict:
    doc = open_pdf(data)
    try:
        page_sizes = []
        total_text_chars = 0
        for index, page in enumerate(doc):
            rect = page.rect
            chars = len(page.get_text("text"))
            total_text_chars += chars
            width_mm = round(pt_to_mm(rect.width), 1)
            height_mm = round(pt_to_mm(rect.height), 1)
            page_sizes.append(
                {
                    "page": index + 1,
                    "width_mm": width_mm,
                    "height_mm": height_mm,
                    "orientation": "landscape" if rect.width > rect.height else "portrait",
                    "rotation": page.rotation,
                    "text_chars": chars,
                }
            )
        return {
            "filename": filename,
            "size_bytes": len(data),
            "pages": doc.page_count,
            "text_chars": total_text_chars,
            "metadata": {k: v for k, v in doc.metadata.items() if v},
            "page_sizes": page_sizes,
            "supported_sizes": list(PAGE_SIZES_MM.keys()) + ["CUSTOM"],
        }
    finally:
        doc.close()


def _apply_crop(doc: pymupdf.Document, top_mm: float, right_mm: float, bottom_mm: float, left_mm: float) -> None:
    if not any((top_mm, right_mm, bottom_mm, left_mm)):
        return
    top = mm_to_pt(max(0, top_mm))
    right = mm_to_pt(max(0, right_mm))
    bottom = mm_to_pt(max(0, bottom_mm))
    left = mm_to_pt(max(0, left_mm))
    for page in doc:
        rect = page.cropbox
        new_rect = pymupdf.Rect(
            rect.x0 + left,
            rect.y0 + top,
            rect.x1 - right,
            rect.y1 - bottom,
        )
        if new_rect.width < 36 or new_rect.height < 36:
            raise HTTPException(422, "هوامش القص كبيرة جدًا بالنسبة إلى حجم الصفحة.")
        page.set_cropbox(new_rect)


def _resize_document(
    doc: pymupdf.Document,
    page_size: str,
    custom_width_mm: float | None,
    custom_height_mm: float | None,
    orientation: str,
) -> pymupdf.Document:
    key = page_size.upper()
    if key == "KEEP":
        return doc

    if key == "CUSTOM":
        if not custom_width_mm or not custom_height_mm:
            raise HTTPException(422, "أدخل العرض والارتفاع للمقاس المخصص.")
        if custom_width_mm < 50 or custom_height_mm < 50 or custom_width_mm > 1500 or custom_height_mm > 1500:
            raise HTTPException(422, "المقاس المخصص يجب أن يكون بين 50 و1500 مم.")
        width_mm, height_mm = custom_width_mm, custom_height_mm
    else:
        if key not in PAGE_SIZES_MM:
            raise HTTPException(422, "مقاس الصفحة غير مدعوم.")
        width_mm, height_mm = PAGE_SIZES_MM[key]

    if orientation == "landscape" and width_mm < height_mm:
        width_mm, height_mm = height_mm, width_mm
    elif orientation == "portrait" and width_mm > height_mm:
        width_mm, height_mm = height_mm, width_mm

    width_pt, height_pt = mm_to_pt(width_mm), mm_to_pt(height_mm)
    resized = pymupdf.open()
    for page_index in range(doc.page_count):
        target = resized.new_page(width=width_pt, height=height_pt)
        margin = 12
        target_rect = pymupdf.Rect(margin, margin, width_pt - margin, height_pt - margin)
        target.show_pdf_page(target_rect, doc, page_index, keep_proportion=True)
    doc.close()
    return resized


def _add_watermark(doc: pymupdf.Document, watermark: str) -> None:
    text = watermark.strip()
    if not text:
        return
    safe = escape(text)
    for page in doc:
        rect = page.rect
        box = pymupdf.Rect(
            rect.x0 + rect.width * 0.12,
            rect.y0 + rect.height * 0.42,
            rect.x1 - rect.width * 0.12,
            rect.y0 + rect.height * 0.58,
        )
        html = (
            '<div style="font-family:sans-serif;font-size:28pt;font-weight:700;'
            'text-align:center;color:#8aa0aa;opacity:0.38;">'
            f"{safe}</div>"
        )
        try:
            page.insert_htmlbox(box, html, overlay=True)
        except Exception:
            page.insert_textbox(
                box,
                text,
                fontsize=24,
                fontname="helv",
                align=pymupdf.TEXT_ALIGN_CENTER,
                color=(0.55, 0.62, 0.66),
                overlay=True,
            )


def _add_page_numbers(doc: pymupdf.Document) -> None:
    total = doc.page_count
    for index, page in enumerate(doc):
        rect = page.rect
        box = pymupdf.Rect(rect.x0 + 24, rect.y1 - 28, rect.x1 - 24, rect.y1 - 8)
        page.insert_textbox(
            box,
            f"{index + 1} / {total}",
            fontsize=9,
            fontname="helv",
            align=pymupdf.TEXT_ALIGN_CENTER,
            color=(0.35, 0.42, 0.46),
            overlay=True,
        )


def edit_pdf(
    data: bytes,
    *,
    page_order: str | None = None,
    rotate: int = 0,
    rotate_pages: str | None = None,
    page_size: str = "keep",
    custom_width_mm: float | None = None,
    custom_height_mm: float | None = None,
    orientation: str = "keep",
    crop_top_mm: float = 0,
    crop_right_mm: float = 0,
    crop_bottom_mm: float = 0,
    crop_left_mm: float = 0,
    watermark: str = "",
    page_numbers: bool = False,
    optimize: bool = True,
) -> bytes:
    source = open_pdf(data)
    try:
        order = parse_page_spec(page_order, source.page_count, default_all=True, allow_duplicates=True)
        work = pymupdf.open()
        for page_number in order:
            work.insert_pdf(source, from_page=page_number - 1, to_page=page_number - 1)
    finally:
        source.close()

    try:
        if rotate not in (0, 90, 180, 270):
            raise HTTPException(422, "الدوران يجب أن يكون 0 أو 90 أو 180 أو 270 درجة.")
        if rotate:
            selected = parse_page_spec(rotate_pages, work.page_count, default_all=True)
            for page_number in selected:
                page = work[page_number - 1]
                page.set_rotation((page.rotation + rotate) % 360)

        _apply_crop(work, crop_top_mm, crop_right_mm, crop_bottom_mm, crop_left_mm)
        work = _resize_document(work, page_size, custom_width_mm, custom_height_mm, orientation)
        _add_watermark(work, watermark)
        if page_numbers:
            _add_page_numbers(work)

        options = {"garbage": 4, "deflate": True, "clean": True} if optimize else {}
        return work.tobytes(**options)
    finally:
        work.close()


def merge_pdfs(files: list[bytes]) -> bytes:
    if len(files) < 2:
        raise HTTPException(422, "اختر ملفي PDF على الأقل للدمج.")
    merged = pymupdf.open()
    try:
        for data in files:
            doc = open_pdf(data)
            try:
                merged.insert_pdf(doc)
            finally:
                doc.close()
        return merged.tobytes(garbage=4, deflate=True, clean=True)
    finally:
        merged.close()
