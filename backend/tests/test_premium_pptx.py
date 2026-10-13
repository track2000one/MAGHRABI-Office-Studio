"""Regression checks for the editable premium PowerPoint exporter."""
from io import BytesIO
import re

from fastapi.testclient import TestClient
from pptx import Presentation

from app.content import Content
from app.exports import export_pptx
from app.main import app


def sample_content(language="ar"):
    return Content(
        title="خطة تطوير الأداء المؤسسي" if language == "ar" else "Institutional Performance Plan",
        summary="مقترح لتحسين جودة الخدمات وتطوير العمليات الداخلية ومتابعة النتائج.",
        language=language,
        sections=[
            {
                "title": "الأهداف الاستراتيجية" if language == "ar" else "Strategic objectives",
                "body": [
                    "رفع كفاءة العمليات وتحسين مستوى الخدمات المقدمة للمستفيدين.",
                    "تنظيم المسؤوليات وتطوير الإجراءات الداخلية بصورة مستمرة.",
                    "قياس النتائج باستخدام مؤشرات موثوقة وقابلة للمراجعة.",
                ],
                "notes": "شرح تفصيلي للاجتماع",
            },
            {
                "title": "خطة العمل" if language == "ar" else "Action plan",
                "body": [
                    "يتم توزيع المهام على الفرق المختصة مع تحديد المخرجات المطلوبة ومواعيد المتابعة.",
                    "تنفيذ مراجعات دورية واعتماد التوصيات بناءً على النتائج الفعلية.",
                ],
                "notes": "",
            },
        ],
    )


def texts(slide):
    return [shape.text for shape in slide.shapes if shape.has_text_frame]


def test_luxury_export_contains_real_editable_text_and_notes():
    content = sample_content()
    deck = Presentation(BytesIO(export_pptx(content)))
    assert len(deck.slides) >= 4  # cover, agenda, 2 varied section slides
    assert any(content.title in text for text in texts(deck.slides[0]))
    assert any("محاور العرض" in text for text in texts(deck.slides[1]))
    for section in content.sections:
        for body in section.body:
            assert any(body == text for slide in deck.slides for text in texts(slide))
    assert any(slide.notes_slide.notes_text_frame.text == content.sections[0].notes
               for slide in deck.slides if slide.has_notes_slide)
    # Editable drawing/text objects, not a single rasterized slide screenshot.
    assert sum(bool(shape.has_text_frame) for slide in deck.slides for shape in slide.shapes) > 10
    assert all(slide.shapes for slide in deck.slides)


def test_all_three_styles_change_presentation_colors_and_keep_content():
    content = sample_content("en")
    colors = []
    for style in ("luxury", "corporate", "minimal"):
        deck = Presentation(BytesIO(export_pptx(content, style)))
        assert len(deck.slides) >= 4
        colors.append(str(deck.slides[0].background.fill.fore_color.rgb))
        assert any("Institutional Performance Plan" in t for t in texts(deck.slides[0]))
        assert any("Action plan" in t for s in deck.slides for t in texts(s))
    assert len(set(colors)) == 3


def test_long_section_is_paginated_with_no_lost_words():
    words = [f"معلومة{index:04d}" for index in range(430)]
    body = " ".join(words)
    assert len(body) < 5000
    # Pydantic limits individual paragraph length; two 2000-char chunks are valid.
    parts = []
    token_words = body.split(" ")
    current = []
    for word in token_words:
        if len(" ".join(current + [word])) > 1900:
            parts.append(" ".join(current))
            current = []
        current.append(word)
    parts.append(" ".join(current))
    content = Content(
        title="مشروع كبير",
        language="ar",
        sections=[{"title": "التفاصيل", "body": parts, "notes": "توضيح"}],
    )
    deck = Presentation(BytesIO(export_pptx(content, "corporate")))
    assert len(deck.slides) > 6
    # Every original word must survive, including the last word.
    export_body = " ".join(t for slide in deck.slides for t in texts(slide))
    for word in words:
        assert word in export_body
    assert len(deck.slides) < 30
    for slide in deck.slides:
        for shape in slide.shapes:
            assert shape.left >= 0 and shape.top >= 0
            assert shape.left + shape.width <= deck.slide_width + 10000
            assert shape.top + shape.height <= deck.slide_height + 10000


def test_pptx_endpoint_style_selection_and_validation():
    content = sample_content()
    with TestClient(app) as client:
        response = client.post("/api/v1/exports/pptx?design_style=luxury",
                               json=content.model_dump())
        assert response.status_code == 200
        assert response.headers["content-type"].startswith(
            "application/vnd.openxmlformats-officedocument.presentationml.presentation")
        assert Presentation(BytesIO(response.content)).slides
        invalid = client.post("/api/v1/exports/pptx?design_style=unknown",
                              json=content.model_dump())
        assert invalid.status_code == 422
