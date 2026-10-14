"""Validated, reusable visual inputs for identical PPTX preview and download."""
from __future__ import annotations

import base64
import binascii
from io import BytesIO
import re

from fastapi import HTTPException
from PIL import Image, ImageOps, UnidentifiedImageError
from pydantic import BaseModel, ConfigDict, Field

from .content import Content

MAX_IMAGE_TEXT = 3_000_000
MAX_TOTAL_TEXT = 13_000_000


class PresentationArtwork(BaseModel):
    model_config = ConfigDict(extra="forbid")
    cover: str | None = Field(default=None, max_length=MAX_IMAGE_TEXT)
    section: str | None = Field(default=None, max_length=MAX_IMAGE_TEXT)
    slides: dict[str, str] = Field(default_factory=dict, max_length=12)


class PresentationRenderRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    content: Content
    artwork: PresentationArtwork = Field(default_factory=PresentationArtwork)


def _decode_art(value: str) -> bytes:
    prefix = "data:image/jpeg;base64,"
    if not value.startswith(prefix) or len(value) > MAX_IMAGE_TEXT:
        raise HTTPException(422, "صورة التصميم غير صالحة؛ يجب أن تكون JPEG.")
    try:
        decoded = base64.b64decode(value[len(prefix):], validate=True)
        if not decoded or len(decoded) > 2_250_000:
            raise ValueError("Image too large")
        with Image.open(BytesIO(decoded)) as image:
            if image.width * image.height > 32_000_000 or min(image.size) < 200:
                raise ValueError("Invalid image dimensions")
            # Re-encode user-controlled artwork; no metadata/external references.
            safe = ImageOps.fit(image.convert("RGB"), (1920, 1080), method=Image.Resampling.LANCZOS)
            output = BytesIO()
            safe.save(output, format="JPEG", quality=83, optimize=True)
            return output.getvalue()
    except (ValueError, binascii.Error, OSError, UnidentifiedImageError) as exc:
        raise HTTPException(422, "تعذر قراءة صورة تصميم الشريحة.") from exc


def validate_artwork(artwork: PresentationArtwork) -> tuple[dict[str, bytes], dict[int, bytes]]:
    items = [x for x in (artwork.cover, artwork.section) if x is not None]
    items.extend(artwork.slides.values())
    if sum(map(len, items)) > MAX_TOTAL_TEXT:
        raise HTTPException(413, "حجم صور العرض كبير جدًا؛ احذف بعض التصاميم.")
    shared = {}
    for key in ("cover", "section"):
        value = getattr(artwork, key)
        if value:
            shared[key] = _decode_art(value)
    slides = {}
    for slide_number, value in artwork.slides.items():
        if not re.fullmatch(r"(0|[1-9][0-9]?)", slide_number):
            raise HTTPException(422, "رقم الشريحة المحددة غير صالح.")
        slides[int(slide_number)] = _decode_art(value)
    return shared, slides


def compose_presentation(request: PresentationRenderRequest, design_style: str) -> bytes:
    from .exports import export_pptx
    shared, slides = validate_artwork(request.artwork)
    try:
        return export_pptx(request.content, design_style, shared, slides)
    except ValueError as exc:
        raise HTTPException(422, "تغيّر عدد الشرائح؛ أنشئ معاينة جديدة وحدّد رقم الشريحة مجددًا.") from exc
