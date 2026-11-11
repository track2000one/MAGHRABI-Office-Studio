"""Opt-in Gemini image assets for hybrid, editable PowerPoint presentations.

Only the deck title and headings are transmitted, never slide bodies or notes.
Image pixels are decorative: all factual content stays in native PPTX text boxes.
"""
from __future__ import annotations

import base64
from io import BytesIO
import logging
import os
import re
from threading import BoundedSemaphore

import httpx
from fastapi import HTTPException
from PIL import Image, ImageOps, UnidentifiedImageError

from . import ai
from .content import Content

_logger = logging.getLogger(__name__)
_slots = BoundedSemaphore(1)
_COLOR_STYLES = {
    "luxury": "midnight navy, champagne gold, sculptural lighting, luxury editorial",
    "corporate": "deep navy, sophisticated teal, architectural geometry, corporate editorial",
    "minimal": "deep indigo, muted lilac, understated modern editorial",
}


def _prompt(content: Content, design_style: str, *, cover: bool) -> str:
    palette = _COLOR_STYLES[design_style]
    subject = content.title[:180] if cover else ", ".join(
        section.title[:100] for section in content.sections[:3]
    )
    purpose = (
        "cinematic presentation cover photograph or refined 3D artwork"
        if cover else
        "editorial illustration with a single strong visual focal point"
    )
    # No sensitive body paragraphs or presenter notes are transmitted.
    return (
        f"Create a premium 16:9 {purpose} for a professional presentation. "
        f"Theme colors and art direction: {palette}. "
        f"Visual subject to interpret (not render as writing): {subject!r}. "
        "Studio quality, refined composition, coherent color palette, subtle textures, "
        "high-end visual storytelling, no stock watermarks. "
        "IMPORTANT: no written text, no labels, no numbers, no charts, no logos, "
        "no letter-like glyphs, no signatures. Text will be placed separately as "
        "real editable PowerPoint objects. Generate image only."
    )


def _normalize_image(encoded: str) -> bytes:
    if not isinstance(encoded, str) or not encoded or len(encoded) > 24_000_000:
        raise ValueError("Invalid generated image length")
    raw = base64.b64decode(encoded, validate=True)
    with Image.open(BytesIO(raw)) as picture:
        if picture.width * picture.height > 32_000_000:
            raise ValueError("Generated image dimensions exceeded limit")
        rendered = ImageOps.fit(
            picture.convert("RGB"), (1920, 1080), method=Image.Resampling.LANCZOS
        )
        buffer = BytesIO()
        rendered.save(buffer, "JPEG", quality=86, optimize=True)
        return buffer.getvalue()


def _generate(client: httpx.Client, model: str, api_key: str, prompt: str) -> bytes:
    response = client.post(
        f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
        headers={"x-goog-api-key": api_key, "Content-Type": "application/json"},
        json={
            "contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": {
                "responseModalities": ["IMAGE"],
                "responseFormat": {"image": {"aspectRatio": "16:9", "imageSize": "2K"}},
            },
        },
    )
    ai._raise_provider_error(response, "gemini")
    try:
        candidates = response.json()["candidates"]
        parts = candidates[0]["content"]["parts"]
        for part in parts:
            image = part.get("inlineData", {})
            if image.get("mimeType", "").startswith("image/") and image.get("data"):
                return _normalize_image(image["data"])
    except (ValueError, KeyError, IndexError, TypeError, UnidentifiedImageError, OSError) as exc:
        raise HTTPException(502, "لم يرجع Nano Banana صورة صالحة يمكن إدراجها في العرض.") from exc
    raise HTTPException(502, "لم يرجع Nano Banana صورة. قد يكون الطلب غير مدعوم أو محجوبًا لدى المزود.")


def generate_visual_assets(content: Content, design_style: str) -> dict[str, bytes]:
    """Exactly two paid image requests per export, never called by ordinary PPTX export."""
    if design_style not in _COLOR_STYLES:
        raise ValueError("Unsupported design style")
    api_key = os.getenv("GEMINI_API_KEY", "").strip()
    if not api_key:
        raise HTTPException(503, "يلزم تفعيل GEMINI_API_KEY في Railway لاستخدام Nano Banana.")
    model = os.getenv("GEMINI_IMAGE_MODEL", "gemini-3-pro-image").strip().removeprefix("models/")
    if not re.fullmatch(r"[A-Za-z0-9_.-]{1,100}", model):
        raise HTTPException(503, "اسم نموذج الصور GEMINI_IMAGE_MODEL غير صالح.")
    if not _slots.acquire(blocking=False):
        raise HTTPException(429, "يجري إنشاء صور لعرض آخر. حاول بعد انتهائه.")
    try:
        with httpx.Client(timeout=httpx.Timeout(50, connect=10)) as client:
            return {
                "cover": _generate(client, model, api_key, _prompt(content, design_style, cover=True)),
                "section": _generate(client, model, api_key, _prompt(content, design_style, cover=False)),
            }
    except httpx.TimeoutException as exc:
        raise HTTPException(504, "انتهت مهلة توليد الصور. لم يُنشأ العرض؛ راجع رصيد المزود قبل المحاولة مجددًا.") from exc
    except httpx.RequestError as exc:
        _logger.warning("Nano Banana connection failed: %s", type(exc).__name__)
        raise HTTPException(502, "تعذر الاتصال بخدمة توليد الصور من Google.") from exc
    finally:
        _slots.release()
