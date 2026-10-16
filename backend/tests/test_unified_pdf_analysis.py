"""Unified Office + PDF analysis: valid PDF, scanned source and rejection checks."""
from io import BytesIO

import pymupdf
from docx import Document
from fastapi.testclient import TestClient

from app.main import app


def make_pdf(*, pages=2, include_text=True):
    doc = pymupdf.open()
    for number in range(pages):
        page = doc.new_page(width=595, height=842 if number % 2 == 0 else 420)
        if include_text:
            page.insert_text((45, 50), "Lecture document text: page " + str(number + 1))
    payload = doc.tobytes()
    doc.close()
    return payload


def upload(client, name, data):
    return client.post("/api/v1/files/analyze", files={
        "file": (name, data, "application/octet-stream")
    })


def test_pdf_supported_in_formats_and_unified_analysis():
    with TestClient(app) as client:
        assert ".pdf" in client.get("/api/v1/formats").json()["supported"]
        response = upload(client, "محاضرة.pdf", make_pdf())
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["filename"] == "محاضرة.pdf"
    assert data["type"] == "pdf"
    assert data["metrics"]["pages"] == 2
    assert data["metrics"]["pages_with_text"] == 2
    assert data["metrics"]["pages_without_text"] == 0
    assert data["metrics"]["landscape_pages"] == 1
    assert data["metrics"]["text_chars"] > 25
    assert "المقاسات" in data["analysis_note"]


def test_pdf_scanned_without_text_gets_accurate_note():
    with TestClient(app) as client:
        result = upload(client, "scanned.PDF", make_pdf(include_text=False))
    assert result.status_code == 200
    assert result.json()["metrics"]["pages_without_text"] == 2
    assert "ممسوحًا" in result.json()["analysis_note"]


def test_pdf_invalid_encrypted_overlarge_and_too_many_pages():
    with TestClient(app) as client:
        invalid = upload(client, "broken.pdf", b"not-a-valid-PDF")
        assert invalid.status_code == 422
        too_large = upload(client, "large.pdf", b"%" * (10 * 1024 * 1024 + 1))
        assert too_large.status_code == 413
        capped = upload(client, "too-many.pdf", make_pdf(pages=301, include_text=False))
        assert capped.status_code == 413
        assert "300" in capped.json()["detail"]

        doc = pymupdf.open(stream=make_pdf(), filetype="pdf")
        encrypted = doc.tobytes(encryption=pymupdf.PDF_ENCRYPT_AES_256,
                               owner_pw="owner-password", user_pw="user-password")
        doc.close()
        blocked = upload(client, "protected.pdf", encrypted)
        assert blocked.status_code == 422
        assert "كلمة مرور" in blocked.json()["detail"]


def test_unified_analysis_still_accepts_word_without_regression():
    doc = Document()
    doc.add_paragraph("Test")
    output = BytesIO()
    doc.save(output)
    with TestClient(app) as client:
        result = upload(client, "test.docx", output.getvalue())
    assert result.status_code == 200, result.text
    assert result.json()["type"] == "word"
    assert result.json()["metrics"]["paragraphs"] == 1
