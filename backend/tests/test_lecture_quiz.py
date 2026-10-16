"""Lecture quiz security, text extraction, grounded MCQs and API regression tests."""
from io import BytesIO
import json

from docx import Document
from fastapi.testclient import TestClient
import fitz
import pytest

from app import quiz
from app.main import app


SOURCE = (
    "The cardiovascular system contains the heart, blood vessels, and blood. "
    "The heart sends blood through arteries to tissues. Veins return blood to the heart. "
    "Capillaries are the smallest vessels and are the site of gas and nutrient exchange. "
    "Oxygen binds to hemoglobin inside red blood cells. "
    "The pulmonary circulation sends blood from the heart to the lungs and back. "
) * 3
QUOTES = [
    "The heart sends blood through arteries to tissues.",
    "Veins return blood to the heart.",
    "Capillaries are the smallest vessels",
    "Oxygen binds to hemoglobin inside red blood cells.",
    "The pulmonary circulation sends blood from the heart to the lungs and back.",
]


def docx_data():
    document = Document()
    document.add_heading("Lecture on circulation", 0)
    document.add_paragraph(SOURCE)
    document.add_paragraph("Additional study note: " + SOURCE)
    result = BytesIO()
    document.save(result)
    return result.getvalue()


def pdf_data():
    doc = fitz.open()
    p = doc.new_page()
    p.insert_textbox(fitz.Rect(50, 50, 550, 780), SOURCE[:600], fontsize=10)
    p2 = doc.new_page()
    p2.insert_textbox(fitz.Rect(50, 50, 550, 780), SOURCE[600:], fontsize=10)
    result = doc.tobytes()
    doc.close()
    return result


def mock_bank(count=5, quote=None):
    questions=[]
    for i in range(count):
        questions.append({
            "question": f"What is the primary fact number {i+1} supported by the lecture?",
            "options": ["Option Alpha","Option Beta","Option Gamma","Option Delta"],
            "correct_index": i % 4, "explanation": "This is the correct choice because the lecture supports it.",
            "source_quote": quote or QUOTES[i % len(QUOTES)], "source_page": 1,
        })
    return {"title": "Practice from circulation lecture", "questions": questions}


def test_extract_docx_retains_paragraphs_and_page_context():
    out = quiz.extract_lecture(docx_data(), "Circulation.docx")
    assert out.pages == 1
    assert "[PAGE 1]" in out.source_text
    assert "Capillaries" in out.source_text
    assert out.truncated is False


def test_extract_pdf_retains_page_markers():
    out=quiz.extract_lecture(pdf_data(), "Circulation.pdf")
    assert out.pages==2
    assert "[PAGE 1]" in out.source_text
    assert "[PAGE 2]" in out.source_text


def test_invalid_and_image_only_files_fail_without_ocr():
    with pytest.raises(Exception) as error:
        quiz.extract_lecture(b"not a real pdf", "report.pdf")
    assert error.value.status_code==422
    with pytest.raises(Exception) as invalid:
        quiz.extract_lecture(b"12345678", "report.doc")
    assert invalid.value.status_code==415
    scanned=fitz.open()
    scanned.new_page()
    raw=scanned.tobytes()
    scanned.close()
    with pytest.raises(Exception) as blank:
        quiz.extract_lecture(raw,"scanned.pdf")
    assert blank.value.status_code==422
    assert "قابل" in str(blank.value.detail)


def test_quiz_rejects_wrong_count_duplicate_options_and_unmatched_evidence(monkeypatch):
    monkeypatch.setattr(quiz.ai,"status",lambda:{"configured":True})
    monkeypatch.setattr(quiz, "_provider_quiz",lambda client,payload:json.dumps(mock_bank(5)))
    request=quiz.QuizRequest(source_text="[PAGE 1]\n"+SOURCE,count=10)
    with pytest.raises(Exception) as count_error:
        quiz.create_quiz(request)
    assert count_error.value.status_code==502
    monkeypatch.setattr(quiz,"_provider_quiz",lambda client,payload:json.dumps(mock_bank(5,quote="Quote never present in user lecture")))
    with pytest.raises(Exception) as source_error:
        quiz.create_quiz(quiz.QuizRequest(source_text="[PAGE 1]\n"+SOURCE,count=5))
    assert source_error.value.status_code==502
    bad=mock_bank(5)
    bad["questions"][0]["options"]=["same","same","different","another"]
    monkeypatch.setattr(quiz,"_provider_quiz",lambda client,payload:json.dumps(bad))
    with pytest.raises(Exception) as options_error:
        quiz.create_quiz(quiz.QuizRequest(source_text="[PAGE 1]\n"+SOURCE,count=5))
    assert options_error.value.status_code==502


def test_question_evidence_page_is_derived_not_trusted(monkeypatch):
    monkeypatch.setattr(quiz.ai,"status",lambda:{"configured":True})
    mocked=mock_bank(5)
    mocked["questions"][0]["source_page"]=80
    monkeypatch.setattr(quiz,"_provider_quiz",lambda client,payload:json.dumps(mocked))
    data=quiz.create_quiz(quiz.QuizRequest(source_text="[PAGE 1]\n"+SOURCE,count=5))
    assert len(data.questions)==5
    assert data.questions[0].source_page==1


def test_endpoint_requires_ai_session_and_reuses_upload_text(monkeypatch):
    monkeypatch.setenv("STUDIO_ACCESS_TOKEN","strong-test-office-token")
    monkeypatch.setenv("AI_PROVIDER","gemini")
    monkeypatch.setenv("GEMINI_API_KEY","placeholder-only")
    monkeypatch.setenv("GEMINI_MODEL","placeholder")
    monkeypatch.setattr(quiz,"_provider_quiz",lambda client,payload:json.dumps(mock_bank(payload["count"])))
    with TestClient(app) as client:
        unauth=client.post("/api/v1/quiz/extract",files={"file":("lecture.docx",docx_data(),
                      "application/vnd.openxmlformats-officedocument.wordprocessingml.document")})
        assert unauth.status_code==401
        login=client.post("/api/v1/ai/login",json={"access_token":"strong-test-office-token"})
        assert login.status_code==200
        extracted=client.post("/api/v1/quiz/extract",headers={"X-Maghrabi-Client":"studio"},
                      files={"file":("lecture.docx",docx_data(),
                      "application/vnd.openxmlformats-officedocument.wordprocessingml.document")})
        assert extracted.status_code==200,extracted.text
        text=extracted.json()["source_text"]
        generated=client.post("/api/v1/quiz/generate",headers={"X-Maghrabi-Client":"studio"},
                         json={"source_text":text,"count":5,"difficulty":"hard","language":"en"})
        assert generated.status_code==200,generated.text
        assert len(generated.json()["questions"])==5
        assert generated.json()["questions"][0]["source_quote"] in text


@pytest.mark.parametrize("count,difficulty",[(0,"easy"),(100,"easy"),(5,"invalid"),(2,"mixed")])
def test_invalid_quiz_settings_are_rejected(count,difficulty):
    with pytest.raises(ValueError):
        quiz.QuizRequest(source_text="[PAGE 1]\n"+SOURCE,count=count,difficulty=difficulty)
