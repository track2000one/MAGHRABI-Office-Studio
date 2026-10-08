import json
from io import BytesIO

import pymupdf
from fastapi.testclient import TestClient
from PIL import Image

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


def make_png(size=(240, 120)) -> bytes:
    output = BytesIO()
    image = Image.new("RGBA", size, (30, 120, 180, 255))
    image.save(output, format="PNG")
    return output.getvalue()


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


def test_pdf_insert_image_targets_selected_page_and_position():
    data = make_pdf()
    image = make_png()
    response = client.post(
        "/api/v1/pdf/insert-image",
        files={
            "file": ("sample.pdf", data, "application/pdf"),
            "image": ("logo.png", image, "image/png"),
        },
        data={
            "image_pages": "2",
            "position": "top_right",
            "width_mm": "40",
            "height_mm": "20",
            "keep_aspect": "true",
            "opacity": "0.75",
            "image_rotation": "0",
            "overlay": "true",
        },
    )
    assert response.status_code == 200
    edited = pymupdf.open(stream=response.content, filetype="pdf")
    try:
        assert len(edited[0].get_images(full=True)) == 0
        images = edited[1].get_images(full=True)
        assert len(images) == 1
        rects = edited[1].get_image_rects(images[0][0])
        assert rects
        assert rects[0].x0 > edited[1].rect.width / 2
        assert rects[0].y0 < edited[1].rect.height / 3
    finally:
        edited.close()


def test_pdf_insert_image_supports_custom_position_and_full_page_background():
    data = make_pdf(page_sizes=((595, 842),))
    image = make_png((100, 100))
    custom = client.post(
        "/api/v1/pdf/insert-image",
        files={
            "file": ("sample.pdf", data, "application/pdf"),
            "image": ("stamp.png", image, "image/png"),
        },
        data={
            "image_pages": "1",
            "position": "custom",
            "x_mm": "25",
            "y_mm": "30",
            "width_mm": "35",
            "height_mm": "35",
            "image_rotation": "90",
            "overlay": "true",
        },
    )
    assert custom.status_code == 200

    background = client.post(
        "/api/v1/pdf/insert-image",
        files={
            "file": ("sample.pdf", data, "application/pdf"),
            "image": ("background.webp", image, "image/webp"),
        },
        data={
            "position": "full_page",
            "keep_aspect": "false",
            "opacity": "0.4",
            "overlay": "false",
        },
    )
    assert background.status_code == 200
    edited = pymupdf.open(stream=background.content, filetype="pdf")
    try:
        images = edited[0].get_images(full=True)
        assert len(images) == 1
        rects = edited[0].get_image_rects(images[0][0])
        assert rects
        assert abs(rects[0].width - edited[0].rect.width) < 2
        assert abs(rects[0].height - edited[0].rect.height) < 2
    finally:
        edited.close()


def test_pdf_insert_image_rejects_unsupported_image_type():
    data = make_pdf(page_sizes=((300, 400),))
    response = client.post(
        "/api/v1/pdf/insert-image",
        files={
            "file": ("sample.pdf", data, "application/pdf"),
            "image": ("logo.svg", b"<svg></svg>", "image/svg+xml"),
        },
    )
    assert response.status_code == 415


def test_pdf_render_page_returns_png_preview():
    data = make_pdf(page_sizes=((595, 842),))
    response = client.post(
        "/api/v1/pdf/render-page",
        files={"file": ("sample.pdf", data, "application/pdf")},
        data={"page_number": "1", "max_width_px": "900"},
    )
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("image/png")
    assert response.content.startswith(b"\x89PNG")


def test_pdf_visual_editor_applies_text_and_image_in_one_save():
    data = make_pdf(page_sizes=((595, 842),))
    image = make_png((160, 90))
    elements = [
        {
            "id": "text-1",
            "type": "text",
            "page": 1,
            "x_mm": 20,
            "y_mm": 25,
            "width_mm": 80,
            "height_mm": 25,
            "rotation": 0,
            "opacity": 1,
            "text": "Visual editor text",
            "font_size_pt": 16,
            "color": "#173645",
            "bold": True,
            "align": "right",
            "rtl": False,
        },
        {
            "id": "image-1",
            "type": "image",
            "page": 1,
            "x_mm": 110,
            "y_mm": 35,
            "width_mm": 45,
            "height_mm": 30,
            "rotation": 0,
            "opacity": 0.8,
            "asset_index": 0,
            "keep_aspect": True,
        },
    ]
    response = client.post(
        "/api/v1/pdf/apply-visual-edits",
        files=[
            ("file", ("sample.pdf", data, "application/pdf")),
            ("assets", ("logo.png", image, "image/png")),
        ],
        data={"elements_json": json.dumps(elements)},
    )
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/pdf")
    edited = pymupdf.open(stream=response.content, filetype="pdf")
    try:
        assert edited.page_count == 1
        assert "Visual editor text" in edited[0].get_text("text")
        assert len(edited[0].get_images(full=True)) >= 1
    finally:
        edited.close()


def test_pdf_visual_editor_rejects_missing_asset_reference():
    data = make_pdf(page_sizes=((595, 842),))
    elements = [
        {
            "id": "image-1",
            "type": "image",
            "page": 1,
            "x_mm": 10,
            "y_mm": 10,
            "width_mm": 40,
            "height_mm": 30,
            "rotation": 0,
            "opacity": 1,
            "asset_index": 0,
            "keep_aspect": True,
        }
    ]
    response = client.post(
        "/api/v1/pdf/apply-visual-edits",
        files={"file": ("sample.pdf", data, "application/pdf")},
        data={"elements_json": json.dumps(elements)},
    )
    assert response.status_code == 422
