"""Strictly user-supplied DOCX branding and editable table settings."""
from __future__ import annotations

from io import BytesIO
from typing import Annotated

from PIL import Image, UnidentifiedImageError
from pydantic import BaseModel, ConfigDict, Field, model_validator


class WordCustomization(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    organization_name: str = Field(default="", max_length=150)
    header_text: str = Field(default="", max_length=160)
    footer_text: str = Field(default="", max_length=160)
    table_title: str = Field(default="", max_length=160)
    table_rows: list[list[Annotated[str, Field(max_length=240)]]] = Field(
        default_factory=list, max_length=31
    )

    @model_validator(mode="after")
    def verify_table(self):
        if not self.table_rows:
            if self.table_title:
                raise ValueError("لا يمكن إضافة عنوان جدول دون إدخال بيانات الجدول.")
            return self
        width = len(self.table_rows[0])
        if width < 2 or width > 6:
            raise ValueError("يتطلب الجدول من عمودين إلى ستة أعمدة.")
        if len(self.table_rows) < 2:
            raise ValueError("أدخل صف العناوين وصف بيانات واحدًا على الأقل.")
        if any(len(row) != width for row in self.table_rows):
            raise ValueError("يجب أن يكون عدد الأعمدة متساويًا في جميع صفوف الجدول.")
        if any(not cell.strip() for cell in self.table_rows[0]):
            raise ValueError("لا تترك عنوان أي عمود فارغًا.")
        return self


MAX_LOGO_BYTES = 1024 * 1024


def validate_logo_bytes(value: bytes) -> bytes:
    if len(value) > MAX_LOGO_BYTES:
        raise ValueError("حجم الشعار يجب ألا يتجاوز 1 ميجابايت.")
    if not value:
        raise ValueError("ملف الشعار فارغ.")
    try:
        with Image.open(BytesIO(value)) as opened:
            if opened.format not in ("PNG", "JPEG"):
                raise ValueError("يدعم الشعار صور PNG وJPEG فقط.")
            width, height = opened.size
            if width < 32 or height < 32 or width > 5000 or height > 5000 or width * height > 12_000_000:
                raise ValueError("أبعاد الشعار غير مدعومة؛ استخدم صورة بين 32 و5000 بكسل.")
            opened.verify()
    except (UnidentifiedImageError, OSError, SyntaxError, Image.DecompressionBombError) as exc:
        raise ValueError("تعذر قراءة صورة الشعار. اختر ملف PNG أو JPEG صالحًا.") from exc
    return value
