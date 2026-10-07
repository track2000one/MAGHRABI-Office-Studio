from io import BytesIO

import pymupdf
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def make_pdf(page_sizes=((595, 842), (842, 595)), label="sample") -> bytes:
    doc = pymupdf.open()
    for index, (width, height) in enumerate(page_sizes, start=1):
        page = doc.new_page(width=width, height=height)
        page.insert_text((50, 60), f"{label} page {index}")
    data = doc.tobytes()
    doc.close()
    return data


def test_pdf_analyze_reports_pages_and_sizes():
    data = make_pdf()
    response = client.post(
        "/api/v1/pdf/analyze",
        files={"file": ("sample.pdf", data, "application/pdf")},
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["pages"] == 2
    assert len(payload["page_sizes"]) == 2
    assert payload["page_sizes"][0]["orientation"] == "portrait"
    assert payload["page_sizes"][1]["orientation"] == "landscape"
    assert "A4" in payload["supported_sizes"]


def test_pdf_edit_reorders_resizes_rotates_and_numbers_pages():
    data = make_pdf()
    response = client.post(
        "/api/v1/pdf/edit",
        files={"file": ("sample.pdf", data, "application/pdf")},
        data={
            "page_order": "2,1",
            "rotate": "90",
            "rotate_pages": "1",
            "page_size": "A4",
            "orientation": "portrait",
            "crop_top_mm": "2",
            "crop_right_mm": "2",
            "crop_bottom_mm": "2",
            "crop_left_mm": "2",
            "watermark": "INTERNAL",
            "page_numbers": "true",
            "optimize": "true",
        },
    )
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/pdf")
    edited = pymupdf.open(stream=response.content, filetype="pdf")
    try:
        assert edited.page_count == 2
        page = edited[0]
        assert abs(page.rect.width - 595.3) < 3
        assert abs(page.rect.height - 841.9) < 3
        text = " ".join(p.get_text("text") for p in edited)
        assert "2 / 2" in text
    finally:
        edited.close()


def test_pdf_page_order_can_extract_and_duplicate_pages():
    data = make_pdf(page_sizes=((300, 400), (300, 400), (300, 400)))
    response = client.post(
        "/api/v1/pdf/edit",
        files={"file": ("sample.pdf", data, "application/pdf")},
        data={"page_order": "3,1,3", "page_size": "keep"},
    )
    assert response.status_code == 200
    edited = pymupdf.open(stream=response.content, filetype="pdf")
    try:
        assert edited.page_count == 3
        first_text = edited[0].get_text("text")
        last_text = edited[2].get_text("text")
        assert "page 3" in first_text
        assert "page 3" in last_text
    finally:
        edited.close()


def test_pdf_merge_combines_multiple_files():
    first = make_pdf(page_sizes=((300, 400),), label="first")
    second = make_pdf(page_sizes=((400, 300),), label="second")
    response = client.post(
        "/api/v1/pdf/merge",
        files=[
            ("files", ("first.pdf", first, "application/pdf")),
            ("files", ("second.pdf", second, "application/pdf")),
        ],
    )
    assert response.status_code == 200
    merged = pymupdf.open(stream=response.content, filetype="pdf")
    try:
        assert merged.page_count == 2
        assert "first" in merged[0].get_text("text")
        assert "second" in merged[1].get_text("text")
    finally:
        merged.close()


def test_pdf_rejects_invalid_page_numbers():
    data = make_pdf(page_sizes=((300, 400),))
    response = client.post(
        "/api/v1/pdf/edit",
        files={"file": ("sample.pdf", data, "application/pdf")},
        data={"page_order": "2"},
    )
    assert response.status_code == 422
