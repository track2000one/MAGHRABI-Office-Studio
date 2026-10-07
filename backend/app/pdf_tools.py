from __future__ import annotations

from html import escape
from io import BytesIO
import re

import pymupdf
from fastapi import HTTPException
from PIL import Image, UnidentifiedImageError

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
MAX_IMAGE_UPLOAD = 15 * 1024 * 1024
MAX_IMAGE_PIXELS = 60_000_000


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
    for token in re.split(r"[,\s;]+", raw):
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



def render_pdf_page(data: bytes, page_number: int, max_width_px: int = 1200) -> bytes:
    doc = open_pdf(data)
    try:
        if page_number < 1 or page_number > doc.page_count:
            raise HTTPException(422, f"رقم الصفحة يجب أن يكون بين 1 و{doc.page_count}.")
        if max_width_px < 320 or max_width_px > 2400:
            raise HTTPException(422, "عرض المعاينة يجب أن يكون بين 320 و2400 بكسل.")
        page = doc[page_number - 1]
        zoom = max(1.0, min(3.0, max_width_px / max(page.rect.width, 1)))
        pix = page.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom), alpha=False)
        return pix.tobytes("png")
    finally:
        doc.close()


def _prepare_image(data: bytes, opacity: float) -> tuple[bytes, int, int]:
    if not data:
        raise HTTPException(400, "ملف الصورة فارغ.")
    if len(data) > MAX_IMAGE_UPLOAD:
        raise HTTPException(413, "حجم الصورة يتجاوز 15 ميجابايت.")
    if opacity <= 0 or opacity > 1:
        raise HTTPException(422, "الشفافية يجب أن تكون أكبر من 0 وحتى 1.")

    try:
        with Image.open(BytesIO(data)) as image:
            image.load()
            width, height = image.size
            if width < 1 or height < 1 or width * height > MAX_IMAGE_PIXELS:
                raise HTTPException(422, "أبعاد الصورة كبيرة جدًا للمعالجة الآمنة.")

            if opacity >= 0.999 and image.format in {"PNG", "JPEG", "JPG"}:
                return data, width, height

            rgba = image.convert("RGBA")
            if opacity < 0.999:
                alpha = rgba.getchannel("A")
                alpha = alpha.point(lambda value: int(value * opacity))
                rgba.putalpha(alpha)

            output = BytesIO()
            rgba.save(output, format="PNG", optimize=True)
            return output.getvalue(), width, height
    except HTTPException:
        raise
    except (UnidentifiedImageError, OSError, ValueError) as exc:
        raise HTTPException(422, "تعذر قراءة الصورة. استخدم PNG أو JPG أو JPEG أو WEBP صالحًا.") from exc


def _image_rect(
    page: pymupdf.Page,
    *,
    position: str,
    width_mm: float,
    height_mm: float,
    x_mm: float,
    y_mm: float,
) -> pymupdf.Rect:
    rect = page.rect
    position = position.lower().strip()
    if position == "full_page":
        return pymupdf.Rect(rect)

    width = mm_to_pt(width_mm)
    height = mm_to_pt(height_mm)
    if width <= 0 or height <= 0:
        raise HTTPException(422, "عرض الصورة وارتفاعها يجب أن يكونا أكبر من صفر.")
    if width > rect.width * 2 or height > rect.height * 2:
        raise HTTPException(422, "حجم الصورة أكبر من الحد المناسب للصفحة.")

    margin = mm_to_pt(10)
    if position == "top_right":
        x0, y0 = rect.x1 - margin - width, rect.y0 + margin
    elif position == "top_left":
        x0, y0 = rect.x0 + margin, rect.y0 + margin
    elif position == "center":
        x0, y0 = rect.x0 + (rect.width - width) / 2, rect.y0 + (rect.height - height) / 2
    elif position == "bottom_right":
        x0, y0 = rect.x1 - margin - width, rect.y1 - margin - height
    elif position == "bottom_left":
        x0, y0 = rect.x0 + margin, rect.y1 - margin - height
    elif position == "custom":
        x0, y0 = rect.x0 + mm_to_pt(x_mm), rect.y0 + mm_to_pt(y_mm)
    else:
        raise HTTPException(422, "موضع الصورة غير مدعوم.")

    target = pymupdf.Rect(x0, y0, x0 + width, y0 + height)
    if target.x1 <= rect.x0 or target.x0 >= rect.x1 or target.y1 <= rect.y0 or target.y0 >= rect.y1:
        raise HTTPException(422, "موضع الصورة يقع خارج الصفحة.")
    return target


def insert_image_into_pdf(
    data: bytes,
    image_data: bytes,
    *,
    image_pages: str | None = None,
    position: str = "top_right",
    width_mm: float = 40,
    height_mm: float = 40,
    x_mm: float = 10,
    y_mm: float = 10,
    keep_aspect: bool = True,
    opacity: float = 1,
    image_rotation: int = 0,
    overlay: bool = True,
) -> bytes:
    if image_rotation not in (0, 90, 180, 270):
        raise HTTPException(422, "تدوير الصورة يجب أن يكون 0 أو 90 أو 180 أو 270 درجة.")
    prepared, _, _ = _prepare_image(image_data, opacity)
    doc = open_pdf(data)
    try:
        selected = parse_page_spec(image_pages, doc.page_count, default_all=True)
        for page_number in selected:
            page = doc[page_number - 1]
            target = _image_rect(
                page,
                position=position,
                width_mm=width_mm,
                height_mm=height_mm,
                x_mm=x_mm,
                y_mm=y_mm,
            )
            page.insert_image(
                target,
                stream=prepared,
                keep_proportion=keep_aspect,
                rotate=image_rotation,
                overlay=overlay,
            )
        return doc.tobytes(garbage=4, deflate=True, clean=True)
    finally:
        doc.close()
