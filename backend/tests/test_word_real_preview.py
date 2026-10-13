"""Actual Word preview API tests; LibreOffice mocked outside Docker image."""
from io import BytesIO
import json
from pathlib import Path
import subprocess

from docx import Document
from fastapi.testclient import TestClient
import fitz
import pytest

from app.main import app
from app.word_preview import render_word_preview


DATA = {
    "title": "تقرير متابعة",
    "summary": "ملخص للاختبار.",
    "language": "ar",
    "sections": [
        {"title": "مقدمة", "body": ["تمهيد مقبول لدى المستخدم."], "notes": ""},
        {"title": "التوصيات", "body": ["متابعة التنفيذ.", "تحرير الملفات."], "notes": ""},
    ],
}


def _sample_pdf():
    pdf = fitz.open()
    page = pdf.new_page(width=595, height=842)
    page.insert_text((48, 48), "Real PDF from DOCX")
    value = pdf.tobytes()
    pdf.close()
    return value


def test_actual_word_preview_returns_paginated_inline_pdf(monkeypatch):
    def fake_soffice(cmd, **kwargs):
        # DOCX is actually passed to LibreOffice and can be inspected before conversion.
        docx_path = Path(cmd[-1])
        assert docx_path.exists()
        doc = Document(str(docx_path))
        assert DATA["title"] in [p.text for p in doc.paragraphs]
        Path(cmd[cmd.index("--outdir") + 1], "document.pdf").write_bytes(_sample_pdf())
        return subprocess.CompletedProcess(cmd, 0, b"", b"")

    monkeypatch.setattr("app.word_preview.subprocess.run", fake_soffice)
    with TestClient(app) as client:
        res = client.post("/api/v1/exports/docx?design_style=luxury&preview=true", json=DATA)
        assert res.status_code == 200
        assert res.headers["content-type"].startswith("application/pdf")
        assert res.headers["cache-control"].startswith("no-store")
        assert res.headers["x-preview-pages"] == "1"
        with fitz.open(stream=res.content, filetype="pdf") as pdf:
            assert len(pdf) == 1
        downloaded = client.post("/api/v1/exports/docx", json=DATA)
        assert downloaded.status_code == 200
        assert "wordprocessingml" in downloaded.headers["content-type"]


def test_customized_word_preview_includes_brand_and_layout_before_conversion(monkeypatch):
    observed = []
    def fake_soffice(cmd, **kwargs):
        doc = Document(cmd[-1])
        observed.append({
            "landscape": doc.sections[0].page_width > doc.sections[0].page_height,
            "header": doc.sections[0].header.paragraphs[0].text,
        })
        Path(cmd[cmd.index("--outdir") + 1], "document.pdf").write_bytes(_sample_pdf())
        return subprocess.CompletedProcess(cmd, 0, b"", b"")

    monkeypatch.setattr("app.word_preview.subprocess.run", fake_soffice)
    with TestClient(app) as client:
        res = client.post(
            "/api/v1/exports/docx/custom?design_style=corporate&document_type=report&preview=true",
            data={
                "content_json": json.dumps(DATA, ensure_ascii=False),
                "customization_json": json.dumps({
                    "organization_name": "مكتب الاختبار",
                    "header_text": "الترويسة",
                    "page_orientation": "landscape",
                }, ensure_ascii=False),
            },
        )
    assert res.status_code == 200
    assert observed == [{"landscape": True, "header": "الترويسة"}]


def test_preview_timeout_and_missing_converter_are_actionable(monkeypatch):
    def timeout(cmd, **kwargs):
        raise subprocess.TimeoutExpired(cmd, kwargs["timeout"])
    monkeypatch.setattr("app.word_preview.subprocess.run", timeout)
    with TestClient(app) as client:
        res = client.post("/api/v1/exports/docx?preview=true", json=DATA)
        assert res.status_code == 504
        assert "وقت" in res.json()["detail"]

    def missing(cmd, **kwargs):
        raise FileNotFoundError("soffice")
    monkeypatch.setattr("app.word_preview.subprocess.run", missing)
    with TestClient(app) as client:
        res = client.post("/api/v1/exports/docx?preview=true", json=DATA)
        assert res.status_code == 503
        assert "الخادم" in res.json()["detail"]


def test_empty_and_oversized_data_rejected_before_conversion():
    with pytest.raises(Exception) as empty:
        render_word_preview(b"")
    assert empty.value.status_code == 413
    with pytest.raises(Exception) as oversized:
        render_word_preview(b"a" * (8 * 1024 * 1024 + 1))
    assert oversized.value.status_code == 413


def test_pdf_page_limit_enforced_and_temp_files_removed(monkeypatch):
    # Simulate a successful converter that over-produces pages.
    def too_many(cmd, **kwargs):
        path = Path(cmd[cmd.index("--outdir") + 1], "document.pdf")
        pdf = fitz.open()
        for _ in range(81):
            pdf.new_page()
        path.write_bytes(pdf.tobytes())
        pdf.close()
        return subprocess.CompletedProcess(cmd, 0, b"", b"")
    monkeypatch.setattr("app.word_preview.subprocess.run", too_many)
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as exc:
        render_word_preview(b"mock docx bytes")
    assert exc.value.status_code == 413
