from __future__ import annotations

from io import BytesIO
from pathlib import Path
import os
from zipfile import ZipFile, BadZipFile

from docx import Document
from fastapi import FastAPI, File, Form, HTTPException, UploadFile, Header
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, FileResponse
from fastapi.staticfiles import StaticFiles
from .content import Content, GenerateRequest, ReviseRequest
from . import ai
from .exports import export_docx, export_pptx, format_docx
from .pdf_tools import analyze_pdf, edit_pdf, insert_image_into_pdf, merge_pdfs, render_pdf_page, MAX_IMAGE_UPLOAD, MAX_PDF_UPLOAD
from openpyxl import load_workbook
from pptx import Presentation

app = FastAPI(
    title="MAGHRABI Office Studio API",
    version="0.2.0",
    description="Document creation, Office analysis, and full-scale PDF editing engine.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin.strip() for origin in os.getenv("CORS_ORIGINS", "http://localhost:5173").split(",") if origin.strip()],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

SUPPORTED = {
    ".docx": "word",
    ".xlsx": "excel",
    ".pptx": "powerpoint",
}


@app.get("/")
def root():
    if (FRONTEND / "index.html").is_file():
        return FileResponse(FRONTEND / "index.html")
    return {"name": "MAGHRABI Office Studio API", "status": "online", "version": "0.2.0"}


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "healthy"}


@app.get("/api/v1/formats")
def formats() -> dict[str, list[str]]:
    return {"supported": list(SUPPORTED.keys())}


def analyze_docx(data: bytes) -> dict:
    document = Document(BytesIO(data))
    paragraphs = [p for p in document.paragraphs if p.text.strip()]
    styles = sorted({p.style.name for p in paragraphs if p.style is not None})
    tables = document.tables
    headings = sum(1 for p in paragraphs if p.style and p.style.name.lower().startswith("heading"))
    return {
        "paragraphs": len(paragraphs),
        "headings": headings,
        "tables": len(tables),
        "styles": styles[:20],
    }


def analyze_xlsx(data: bytes) -> dict:
    workbook = load_workbook(BytesIO(data), read_only=True, data_only=False)
    sheets = []
    for sheet in workbook.worksheets:
        sheets.append({
            "name": sheet.title,
            "rows": sheet.max_row,
            "columns": sheet.max_column,
        })
    result = {"worksheets": len(workbook.worksheets), "sheets": sheets}
    workbook.close()
    return result


def analyze_pptx(data: bytes) -> dict:
    presentation = Presentation(BytesIO(data))
    text_shapes = 0
    tables = 0
    pictures = 0
    for slide in presentation.slides:
        for shape in slide.shapes:
            if getattr(shape, "has_text_frame", False):
                text_shapes += 1
            if getattr(shape, "has_table", False):
                tables += 1
            if shape.shape_type == 13:
                pictures += 1
    return {
        "slides": len(presentation.slides),
        "text_shapes": text_shapes,
        "tables": tables,
        "pictures": pictures,
    }


@app.post("/api/v1/files/analyze")
async def analyze_file(file: UploadFile = File(...)) -> dict:
    filename = file.filename or "document"
    extension = Path(filename).suffix.lower()
    document_type = SUPPORTED.get(extension)
    if not document_type:
        raise HTTPException(status_code=415, detail="Unsupported file type. Use DOCX, XLSX or PPTX.")

    data = await read_office(file)

    try:
        if extension == ".docx":
            metrics = analyze_docx(data)
        elif extension == ".xlsx":
            metrics = analyze_xlsx(data)
        else:
            metrics = analyze_pptx(data)
    except Exception as exc:
        raise HTTPException(status_code=422, detail="تعذر قراءة الملف. تأكد من أنه ملف Office صالح وغير محمي بكلمة مرور.") from exc

    return {
        "filename": filename,
        "type": document_type,
        "size_bytes": len(data),
        "status": "analyzed",
        "health_score": None,
        "metrics": metrics,
        "issues": [],
        "analysis_note": "النتائج إحصاءات فعلية للمحتوى؛ لا تمثل تقييمًا شاملًا لجودة التنسيق.",
    }


MAX_UPLOAD = 10 * 1024 * 1024
FRONTEND = Path(__file__).resolve().parents[2] / "frontend" / "dist"


async def read_office(file: UploadFile) -> bytes:
    data = await file.read(MAX_UPLOAD + 1)
    if not data:
        raise HTTPException(400, "الملف فارغ.")
    if len(data) > MAX_UPLOAD:
        raise HTTPException(413, "حجم الملف يتجاوز 10 ميجابايت.")
    try:
        with ZipFile(BytesIO(data)) as archive:
            entries = archive.infolist()
            if len(entries) > 2000 or sum(e.file_size for e in entries) > 64 * 1024 * 1024:
                raise HTTPException(413, "محتوى الملف أكبر من الحد المسموح للمعالجة.")
            if any(e.flag_bits & 1 for e in entries):
                raise HTTPException(422, "الملفات المشفرة غير مدعومة.")
    except BadZipFile as exc:
        raise HTTPException(422, "الملف ليس ملف Office صالحًا.") from exc
    return data


def download(data: bytes, kind: str, filename: str):
    mime = {
        'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'pdf': 'application/pdf',
    }[kind]
    return Response(data, media_type=mime, headers={
        'Content-Disposition': f'attachment; filename="{filename}.{kind}"',
        'Cache-Control': 'no-store',
    })


@app.get('/api/v1/ai/status')
def ai_status():
    return ai.status()


@app.post('/api/v1/ai/generate', response_model=Content)
def generate_content(request: GenerateRequest, authorization: str | None = Header(default=None)):
    ai.authorize(authorization)
    return ai.generate(request)


@app.post('/api/v1/ai/revise', response_model=Content)
def revise_content(request: ReviseRequest, authorization: str | None = Header(default=None)):
    ai.authorize(authorization)
    return ai.revise(request)


@app.post('/api/v1/exports/docx')
def docx_export(content: Content):
    return download(export_docx(content), 'docx', 'MAGHRABI-document')


@app.post('/api/v1/exports/pptx')
def pptx_export(content: Content):
    return download(export_pptx(content), 'pptx', 'MAGHRABI-presentation')


@app.post('/api/v1/files/format-docx')
async def format_uploaded_docx(file: UploadFile = File(...)):
    if Path(file.filename or '').suffix.lower() != '.docx':
        raise HTTPException(415, "تنسيق المستندات يدعم DOCX فقط في هذه النسخة.")
    data = await read_office(file)
    try:
        return download(format_docx(data), 'docx', 'MAGHRABI-formatted')
    except Exception as exc:
        raise HTTPException(422, "تعذر تنسيق الملف. تأكد من صلاحية ملف Word.") from exc


@app.post('/api/v1/pdf/analyze')
async def pdf_analyze(file: UploadFile = File(...)):
    if Path(file.filename or '').suffix.lower() != '.pdf':
        raise HTTPException(415, "اختر ملف PDF.")
    data = await file.read(MAX_PDF_UPLOAD + 1)
    if len(data) > MAX_PDF_UPLOAD:
        raise HTTPException(413, "حجم ملف PDF يتجاوز 30 ميجابايت.")
    return analyze_pdf(data, file.filename or "document.pdf")


@app.post('/api/v1/pdf/edit')
async def pdf_edit(
    file: UploadFile = File(...),
    page_order: str = Form(""),
    rotate: int = Form(0),
    rotate_pages: str = Form(""),
    page_size: str = Form("keep"),
    custom_width_mm: float | None = Form(None),
    custom_height_mm: float | None = Form(None),
    orientation: str = Form("keep"),
    crop_top_mm: float = Form(0),
    crop_right_mm: float = Form(0),
    crop_bottom_mm: float = Form(0),
    crop_left_mm: float = Form(0),
    watermark: str = Form(""),
    page_numbers: bool = Form(False),
    optimize: bool = Form(True),
):
    if Path(file.filename or '').suffix.lower() != '.pdf':
        raise HTTPException(415, "اختر ملف PDF.")
    data = await file.read(MAX_PDF_UPLOAD + 1)
    if len(data) > MAX_PDF_UPLOAD:
        raise HTTPException(413, "حجم ملف PDF يتجاوز 30 ميجابايت.")
    result = edit_pdf(
        data,
        page_order=page_order,
        rotate=rotate,
        rotate_pages=rotate_pages,
        page_size=page_size,
        custom_width_mm=custom_width_mm,
        custom_height_mm=custom_height_mm,
        orientation=orientation,
        crop_top_mm=crop_top_mm,
        crop_right_mm=crop_right_mm,
        crop_bottom_mm=crop_bottom_mm,
        crop_left_mm=crop_left_mm,
        watermark=watermark,
        page_numbers=page_numbers,
        optimize=optimize,
    )
    return download(result, 'pdf', 'MAGHRABI-edited')


@app.post('/api/v1/pdf/render-page')
async def pdf_render_page(
    file: UploadFile = File(...),
    page_number: int = Form(1),
    max_width_px: int = Form(1200),
):
    if Path(file.filename or '').suffix.lower() != '.pdf':
        raise HTTPException(415, "اختر ملف PDF.")
    data = await file.read(MAX_PDF_UPLOAD + 1)
    if len(data) > MAX_PDF_UPLOAD:
        raise HTTPException(413, "حجم ملف PDF يتجاوز 30 ميجابايت.")
    preview = render_pdf_page(data, page_number, max_width_px)
    return Response(preview, media_type='image/png', headers={'Cache-Control': 'no-store'})


@app.post('/api/v1/pdf/insert-image')
async def pdf_insert_image(
    file: UploadFile = File(...),
    image: UploadFile = File(...),
    image_pages: str = Form(""),
    position: str = Form("top_right"),
    width_mm: float = Form(40),
    height_mm: float = Form(40),
    x_mm: float = Form(10),
    y_mm: float = Form(10),
    keep_aspect: bool = Form(True),
    opacity: float = Form(1),
    image_rotation: int = Form(0),
    overlay: bool = Form(True),
):
    if Path(file.filename or '').suffix.lower() != '.pdf':
        raise HTTPException(415, "اختر ملف PDF.")
    image_extension = Path(image.filename or '').suffix.lower()
    if image_extension not in {'.png', '.jpg', '.jpeg', '.webp'}:
        raise HTTPException(415, "الصورة يجب أن تكون PNG أو JPG أو JPEG أو WEBP.")

    pdf_data = await file.read(MAX_PDF_UPLOAD + 1)
    if len(pdf_data) > MAX_PDF_UPLOAD:
        raise HTTPException(413, "حجم ملف PDF يتجاوز 30 ميجابايت.")
    image_data = await image.read(MAX_IMAGE_UPLOAD + 1)
    if len(image_data) > MAX_IMAGE_UPLOAD:
        raise HTTPException(413, "حجم الصورة يتجاوز 15 ميجابايت.")

    result = insert_image_into_pdf(
        pdf_data,
        image_data,
        image_pages=image_pages,
        position=position,
        width_mm=width_mm,
        height_mm=height_mm,
        x_mm=x_mm,
        y_mm=y_mm,
        keep_aspect=keep_aspect,
        opacity=opacity,
        image_rotation=image_rotation,
        overlay=overlay,
    )
    return download(result, 'pdf', 'MAGHRABI-image-inserted')


@app.post('/api/v1/pdf/merge')
async def pdf_merge(files: list[UploadFile] = File(...)):
    if len(files) < 2:
        raise HTTPException(422, "اختر ملفي PDF على الأقل للدمج.")
    payloads: list[bytes] = []
    for file in files:
        if Path(file.filename or '').suffix.lower() != '.pdf':
            raise HTTPException(415, "جميع الملفات المرفوعة للدمج يجب أن تكون PDF.")
        data = await file.read(MAX_PDF_UPLOAD + 1)
        if len(data) > MAX_PDF_UPLOAD:
            raise HTTPException(413, f"حجم الملف {file.filename or 'PDF'} يتجاوز 30 ميجابايت.")
        payloads.append(data)
    return download(merge_pdfs(payloads), 'pdf', 'MAGHRABI-merged')


# One Railway service serves the built React app and API on the same origin.
if (FRONTEND / 'assets').is_dir():
    app.mount('/assets', StaticFiles(directory=FRONTEND / 'assets'), name='assets')
