"""Real print-preview acceptance test: detailed Arabic study with logo and table.

Run inside the built production image, where LibreOffice and Arabic fonts exist.
The content and branding here are explicitly fictitious demonstration data.
"""
from io import BytesIO

import pymupdf
from PIL import Image

from app.content import Content
from app.document_customization import WordCustomization
from app.exports import export_docx
from app.word_preview import render_word_preview


paragraph = (
    "نص تجريبي لأغراض اختبار توزيع الصفحات والخطوط العربية وفواصل المحاور "
    "دون الإشارة إلى نتائج واقعية أو معلومات تخص جهة بعينها. "
) * 13

study = Content(
    title="دراسة تجريبية لتطوير إجراءات العمل",
    language="ar",
    summary="ملخص توضيحي مخصص لاختبار المعاينة، وليس دراسة فعلية أو قرارًا معتمدًا.",
    sections=[
        {
            "title": f"المحور التجريبي رقم {index}",
            "body": [paragraph, paragraph],
            "notes": "",
        }
        for index in range(1, 5)
    ],
)
custom = WordCustomization(
    organization_name="جهة افتراضية للاختبار",
    header_text="دراسة تجريبية — غير معتمدة",
    footer_text="نسخة تجريبية",
    table_title="جدول اختبار تنظيم العمل",
    table_rows=[
        ["البند", "المسؤول", "الحالة"],
        ["المهمة الأولى", "فريق تجريبي", "للتجربة فقط"],
        ["المهمة الثانية", "فريق تجريبي", "للتجربة فقط"],
    ],
)

buffer = BytesIO()
Image.new("RGB", (240, 125), "#315477").save(buffer, "PNG")
word = export_docx(study, "luxury", "study", custom, buffer.getvalue())
preview = render_word_preview(word)
assert preview.media_type == "application/pdf"

with pymupdf.open(stream=preview.body, filetype="pdf") as doc:
    pages = len(doc)
    assert pages >= 4, f"Expected multi-page study preview, got {pages}"
    assert int(preview.headers["x-preview-pages"]) == pages

print(f"Real multi-page Arabic study with test logo and table rendered: {pages} pages")
