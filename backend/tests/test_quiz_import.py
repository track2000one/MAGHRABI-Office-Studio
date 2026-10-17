"""Import already-written multiple-choice questions without generating new ones."""
from io import BytesIO

import fitz
from docx import Document
from fastapi.testclient import TestClient

from app.main import app
from app.quiz_import import parse_questions


ENGLISH = """Lecture practice quiz
1. What is the main purpose of a written report?
A) To record research findings
B) To share unrelated gossip
C) To delete information
D) To publish open-source code
Answer: A
2) Where are trends compared?
(A) In tables
(B) In a random list
(C) In an oral chat
(D) In a blank page
Answer: A
3. Which graph illustrates changes over time?
A. Pie chart
B. Line graph ✓
C. Table
D. Histogram
"""

ARABIC = """السؤال ١: أين تُوثَّق نتائج البحث؟
أ) في التقرير المكتوب
ب) في محادثة عابرة
ج) في صورة غير موثقة
د) في ملف خال
الإجابة الصحيحة: أ
السؤال ٢: ما أفضل طريقة لتلخيص بيانات رقمية؟
أ) تجاهلها
ب) جدول واضح
ج) حذف الأرقام
د) سرد غير منظم
مفتاح الإجابات:
١-أ، ٢-ب
"""

def docx_bytes(text):
    doc=Document()
    for line in text.splitlines():
        doc.add_paragraph(line)
    stream=BytesIO()
    doc.save(stream)
    return stream.getvalue()


def pdf_bytes(text):
    doc=fitz.open()
    page=doc.new_page()
    page.insert_textbox(fitz.Rect(36,36,570,795),text,fontsize=11)
    result=doc.tobytes()
    doc.close()
    return result


def test_ready_docx_detects_questions_choices_and_inline_answer_keys():
    imported=parse_questions(docx_bytes(ENGLISH),"Questions.docx")
    assert imported.title=="Questions"
    assert len(imported.questions)==3
    assert imported.detected_answers==3
    assert [q.correct_index for q in imported.questions]==[0,0,1]
    assert imported.questions[0].options[0]=="To record research findings"
    assert imported.questions[1].question=="Where are trends compared?"
    assert imported.skipped==0


def test_arabic_numbers_choices_and_end_answer_key():
    result=parse_questions(docx_bytes(ARABIC),"تدريب.docx")
    assert len(result.questions)==2
    assert result.questions[0].correct_index==0
    assert result.questions[1].correct_index==1
    assert result.detected_answers==2


def test_missing_answer_key_is_explicit_and_not_fabricated():
    source="""1) What belongs to the exam?
A) Option 1
B) Option 2
C) Option 3
D) Option 4
"""
    result=parse_questions(docx_bytes(source),"ungraded.docx")
    assert len(result.questions)==1
    assert result.questions[0].correct_index is None
    assert result.detected_answers==0
    assert any("دون مفتاح" in warning for warning in result.warnings)


def test_pdf_preserves_four_options_and_page_reference():
    source="""1. What is the correct chart for changes over time?
A. Pie
B. Line
C. Scatter
D. Histogram
Answer: B
"""
    result=parse_questions(pdf_bytes(source),"charts.pdf")
    assert len(result.questions)==1
    assert result.questions[0].correct_index==1
    assert result.questions[0].source_page==1


def test_incomplete_questions_are_skipped_with_warning():
    source="""1. A complete question?
A. one
B. two
C. three
D. four
2. Incomplete question?
A. one
B. two
"""
    out=parse_questions(docx_bytes(source),"some.docx")
    assert len(out.questions)==1
    assert out.skipped==1
    assert any("تعذر التعرف" in warning for warning in out.warnings)


def test_import_hard_caps_40_and_keeps_input_order():
    source="\n".join(
        f"{i}. Where is question {i} kept?\nA. one\nB. two\nC. three\nD. four"
        for i in range(1,45)
    )
    result=parse_questions(docx_bytes(source),"more.docx")
    assert len(result.questions)==40
    assert result.questions[0].number==1
    assert result.questions[-1].number==40
    assert any("40" in warning for warning in result.warnings)


def test_import_api_does_not_require_ai_session_or_send_file_to_provider():
    with TestClient(app) as client:
        response=client.post("/api/v1/quiz/import",files={
            "file":("questions.docx",docx_bytes(ENGLISH),
                    "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
        })
    assert response.status_code==200,response.text
    assert response.json()["detected_answers"]==3
    assert len(response.json()["questions"])==3


def test_import_rejects_unsupported_corrupt_and_image_only_files():
    with TestClient(app) as client:
        rejected=client.post("/api/v1/quiz/import",files={
            "file":("old.doc",b"not doc","application/msword")})
        assert rejected.status_code==415
        corrupt=client.post("/api/v1/quiz/import",files={"file":("broken.pdf",b"not pdf","application/pdf")})
        assert corrupt.status_code==422
        doc=fitz.open()
        doc.new_page()
        empty=doc.tobytes()
        doc.close()
        scanned=client.post("/api/v1/quiz/import",files={"file":("scanned.pdf",empty,"application/pdf")})
        assert scanned.status_code==422


def test_chatgpt_markdown_paste_imports_40_mcqs_without_ai_or_file_upload():
    import os
    from app.quiz_import import parse_text_questions
    os.environ.pop("OPENAI_API_KEY", None)
    sections = [
        "\n".join([
            f"**{index}.** What does graph number {index} illustrate?",
            "**A)** A bar chart",
            "**B)** A clear line chart",
            "**C)** A random list",
            "**D)** A blank page",
            "**Correct Answer: B**",
            "Explanation: The lecture compares data using line charts.",
        ])
        for index in range(1, 41)
    ]
    imported = parse_text_questions(
        "# Questions from ChatGPT\n\n" + "\n\n".join(sections),
        "Analyzing Graphs — Week 4",
    )
    assert imported.title == "Analyzing Graphs — Week 4"
    assert imported.filename.endswith(".txt")
    assert len(imported.questions) == 40
    assert imported.detected_answers == 40
    assert imported.skipped == 0
    assert imported.questions[0].correct_index == 1
    assert imported.questions[-1].number == 40
    assert "Explanation" not in imported.questions[0].options[3]


def test_pasted_arabic_markdown_with_answer_key_and_unanswered_warning():
    from app.quiz_import import parse_text_questions
    pasted = """### اختبار المحاضرة
**السؤال ١:** ما أفضل طريقة لعرض بيانات شهرية؟
- **أ)** قائمة لا توضح الزمن
- **ب)** رسم خطي
- **ج)** ملف فارغ
- **د)** نص متكرر
**السؤال ٢:** ما وظيفة الفهرس؟
- **أ)** تسهيل الوصول
- **ب)** حذف المحتوى
- **ج)** خلط الفصول
- **د)** تشويه البيانات
**مفتاح الإجابات:**
١-ب
"""
    result = parse_text_questions(pasted, "Week 2")
    assert len(result.questions) == 2
    assert result.questions[0].correct_index == 1
    assert result.questions[1].correct_index is None
    assert result.detected_answers == 1
    assert any("دون مفتاح إجابة" in item for item in result.warnings)


def test_chatgpt_text_import_endpoint_works_with_no_ai_login(monkeypatch):
    from app import ai
    monkeypatch.setattr(ai, "status", lambda: {"configured": False})
    text = """1. Which chart shows monthly trends?
A) Line graph
B) Empty sheet
C) Random pictures
D) A word list
Correct Answer: A
"""
    with TestClient(app) as client:
        response = client.post("/api/v1/quiz/import-text", json={
            "title": "Graph Lecture 4", "text": text,
        })
    assert response.status_code == 200, response.text
    assert response.json()["title"] == "Graph Lecture 4"
    assert response.json()["questions"][0]["correct_index"] == 0


def test_chatgpt_paste_rejects_blank_huge_or_malformed_questions():
    from app.quiz_import import parse_text_questions, MAX_PASTED_CHARS
    from fastapi import HTTPException
    import pytest
    with pytest.raises(HTTPException) as empty:
        parse_text_questions("  ", "Lecture")
    assert empty.value.status_code == 422
    with pytest.raises(HTTPException) as huge:
        parse_text_questions("a" * (MAX_PASTED_CHARS + 1), "Lecture")
    assert huge.value.status_code == 413
    with pytest.raises(HTTPException) as malformed:
        parse_text_questions("1. What is a graph?\nA) Only one option", "Lecture")
    assert malformed.value.status_code == 422
