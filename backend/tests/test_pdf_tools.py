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


def test_pdf_manage_pages_reorders_duplicates_deletes_and_rotates():
    data = make_pdf(page_sizes=((300, 400), (300, 400), (300, 400)))
    response = client.post(
        "/api/v1/pdf/manage-pages",
        files={"file": ("sample.pdf", data, "application/pdf")},
        data={
            "page_plan_json": json.dumps(
                [
                    {"source_page": 3, "rotation": 90},
                    {"source_page": 1, "rotation": 0},
                    {"source_page": 3, "rotation": 0},
                ]
            )
        },
    )
    assert response.status_code == 200
    edited = pymupdf.open(stream=response.content, filetype="pdf")
    try:
        assert edited.page_count == 3
        assert "page 3" in edited[0].get_text("text")
        assert "page 1" in edited[1].get_text("text")
        assert "page 3" in edited[2].get_text("text")
        assert edited[0].rotation == 90
        assert edited[1].rotation == 0
    finally:
        edited.close()


def test_pdf_manage_pages_rejects_empty_plan():
    data = make_pdf(page_sizes=((300, 400),))
    response = client.post(
        "/api/v1/pdf/manage-pages",
        files={"file": ("sample.pdf", data, "application/pdf")},
        data={"page_plan_json": "[]"},
    )
    assert response.status_code == 422



def test_pdf_thumbnail_batch_renders_ordered_compact_jpeg_images():
    from base64 import b64decode
    data=make_pdf(page_sizes=((595,842),)*9)
    result=client.post(
        "/api/v1/pdf/render-thumbnails",
        files={"file":("lecture.pdf",data,"application/pdf")},
        data={"pages":"3,1,7,8","max_width_px":"240"},
    )
    assert result.status_code==200,result.text
    thumbs=result.json()["pages"]
    assert [item["page"] for item in thumbs]==[3,1,7,8]
    for item in thumbs:
        assert item["image"].startswith("data:image/jpeg;base64,")
        content=b64decode(item["image"].split(",",1)[1])
        assert content.startswith(b"\xff\xd8")
        image=Image.open(BytesIO(content))
        assert image.width <= 241
        assert image.height > image.width
    # Batch rendering is not permitted to modify any input PDF.
    with pymupdf.open(stream=data,filetype="pdf") as untouched:
        assert untouched.page_count==9


def test_pdf_thumbnail_batch_limits_pages_width_and_upload_type():
    data=make_pdf(page_sizes=((595,842),)*9)
    def post(pages,width="240",name="lecture.pdf"):
        return client.post("/api/v1/pdf/render-thumbnails",
            files={"file":(name,data,"application/pdf")},
            data={"pages":pages,"max_width_px":width})
    assert post("1,2,3,4,5,6,7,8").status_code==200
    for invalid in ["","1,1","1,10","1,2,3,4,5,6,7,8,9","1,abc","0"]:
        assert post(invalid).status_code==422
    assert post("1","90").status_code==422
    assert post("1","900").status_code==422
    assert post("1",name="not-a-pdf.txt").status_code==415


def test_pdf_thumbnail_batch_single_document_open(monkeypatch):
    from app import pdf_tools
    data=make_pdf(page_sizes=((595,842),)*8)
    calls=[]
    real_open=pdf_tools.open_pdf
    def spy(blob):
        calls.append(len(blob))
        return real_open(blob)
    monkeypatch.setattr(pdf_tools,"open_pdf",spy)
    response=client.post("/api/v1/pdf/render-thumbnails",
        files={"file":("book.pdf",data,"application/pdf")},
        data={"pages":"1,2,3,4,5,6,7,8"})
    assert response.status_code==200
    assert len(response.json()["pages"])==8
    assert calls==[len(data)]


def test_pdf_visual_editor_draws_shapes_as_vectors_on_the_correct_page():
    source = make_pdf(page_sizes=((595, 842), (595, 842)))
    elements = [
        {"type": "shape", "shape": "rectangle", "page": 2, "x_mm": 20,
         "y_mm": 25, "width_mm": 75, "height_mm": 45, "rotation": 0,
         "opacity": 0.75, "stroke_color": "#146eb0", "fill_color": "#ffce55",
         "fill_enabled": True, "stroke_width_pt": 2},
        {"type": "shape", "shape": "ellipse", "page": 2, "x_mm": 100,
         "y_mm": 25, "width_mm": 35, "height_mm": 35, "rotation": 0,
         "opacity": 1, "fill_enabled": False},
        {"type": "shape", "shape": "arrow", "page": 2, "x_mm": 40,
         "y_mm": 110, "width_mm": 75, "height_mm": 25, "rotation": 0,
         "opacity": 1, "flip_x": True, "flip_y": False},
        {"type": "shape", "shape": "highlight", "page": 2, "x_mm": 20,
         "y_mm": 165, "width_mm": 90, "height_mm": 10, "rotation": 0,
         "opacity": 0.35, "fill_color": "#ffe04a"},
        {"type": "shape", "shape": "freehand", "page": 2, "x_mm": 25,
         "y_mm": 190, "width_mm": 100, "height_mm": 20, "rotation": 0,
         "opacity": 1, "points": [[0, 0], [0.25, 0.7], [0.6, 0.3], [1, 1]]},
    ]
    response = client.post(
        "/api/v1/pdf/apply-visual-edits",
        files={"file": ("building-plan.pdf", source, "application/pdf")},
        data={"elements_json": json.dumps(elements)},
    )
    assert response.status_code == 200, response.text
    with pymupdf.open(stream=response.content, filetype="pdf") as edited:
        assert edited.page_count == 2
        assert edited[0].get_drawings() == []
        assert len(edited[1].get_drawings()) >= 5
        assert edited[1].get_images(full=True) == []


def test_pdf_visual_editor_rejects_malformed_shapes_and_paths():
    source = make_pdf(page_sizes=((595, 842),))
    base = {"type": "shape", "shape": "freehand", "page": 1,
            "x_mm": 20, "y_mm": 30, "width_mm": 60, "height_mm": 30,
            "rotation": 0, "opacity": 1,
            "points": [[0, 0], [1, 1]]}
    invalid = [
        {"shape": "unknown"},
        {"shape": "freehand", "points": [[0, 0], [1.1, 0.5]]},
        {"shape": "freehand", "points": [[0, 0]]},
        {"shape": "rectangle", "stroke_color": "url(evil)"},
        {"shape": "rectangle", "stroke_width_pt": 100},
        {"shape": "rectangle", "rotation": 360},
        {"shape": "rectangle", "rotation": -1},
        {"shape": "rectangle", "opacity": "NaN"},
    ]
    for changes in invalid:
        response = client.post(
            "/api/v1/pdf/apply-visual-edits",
            files={"file": ("building-plan.pdf", source, "application/pdf")},
            data={"elements_json": json.dumps([{**base, **changes}])},
        )
        assert response.status_code == 422, (changes, response.text)


def test_pdf_vector_rotation_matches_view_geometry_and_page_isolation():
    data = make_pdf(page_sizes=((595, 842), (595, 842)))
    template = {
        "type": "shape", "page": 2, "shape": "rectangle", "x_mm": 30,
        "y_mm": 50, "width_mm": 55, "height_mm": 20,
        "opacity": 0.7, "rotation": 0,
        "stroke_color": "#1875b1", "fill_color": "#f5c443",
        "fill_enabled": True,
    }
    elements = [template, {
        **template, "x_mm": 110, "rotation": 37,
    }, {
        **template, "shape": "arrow", "x_mm": 30, "y_mm": 100, "rotation": 135,
    }, {
        **template, "shape": "freehand", "y_mm": 130, "rotation": 19,
        "points": [[0, 0], [0.35, 0.75], [1, 1]],
    }]
    response = client.post("/api/v1/pdf/apply-visual-edits",
        files={"file": ("plan.pdf", data, "application/pdf")},
        data={"elements_json": json.dumps(elements)},
    )
    assert response.status_code == 200, response.text
    with pymupdf.open(stream=response.content, filetype="pdf") as doc:
        assert doc.page_count == 2
        assert not doc[0].get_drawings()
        drawings = doc[1].get_drawings()
        assert len(drawings) >= 4
        rect0, rect37 = drawings[0]["rect"], drawings[1]["rect"]
        assert rect37.height > rect0.height + 10, (rect0, rect37)
        assert rect37.width > rect0.width
        assert not doc[1].get_images(full=True)


def test_pdf_visual_shapes_rotation_validates_angle_and_preserves_text_limits():
    data = make_pdf(page_sizes=((595, 842),))
    shape = {
        "type": "shape", "page": 1, "shape": "ellipse", "x_mm": 15,
        "y_mm": 20, "width_mm": 30, "height_mm": 20, "rotation": 359,
        "opacity": 1,
    }
    def post(item):
        return client.post("/api/v1/pdf/apply-visual-edits",
            files={"file": ("sample.pdf", data, "application/pdf")},
            data={"elements_json": json.dumps([item])})
    assert post(shape).status_code == 200
    for angle in (-1, 360, 500):
        assert post({**shape, "rotation": angle}).status_code == 422
    text_element = {**shape, "type": "text", "text": "Test", "rotation": 37}
    assert post(text_element).status_code == 422
