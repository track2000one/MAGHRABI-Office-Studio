"""Render the actual generated DOCX into a temporary, paginated PDF preview.

LibreOffice converts an already-generated DOCX and never edits the downloadable
file. Temporary files and the isolated LibreOffice user profile are destroyed
after each request; avoid user content in logs and exception details.
"""
from __future__ import annotations

from pathlib import Path
import os
import subprocess
import tempfile
from threading import BoundedSemaphore

import fitz
from fastapi import HTTPException
from fastapi.responses import Response

PREVIEW_TIMEOUT_SECONDS = 50
MAX_PREVIEW_PAGES = 80
MAX_PREVIEW_PDF_BYTES = 20 * 1024 * 1024
MAX_PREVIEW_DOCX_BYTES = 8 * 1024 * 1024
_PREVIEW_SLOTS = BoundedSemaphore(2)


def render_word_preview(docx_data: bytes) -> Response:
    if not _PREVIEW_SLOTS.acquire(blocking=False):
        raise HTTPException(429, "خدمة معاينة الصفحات مشغولة حاليًا؛ حاول بعد قليل.")
    try:
        return _render_word_preview(docx_data)
    finally:
        _PREVIEW_SLOTS.release()


def _render_word_preview(docx_data: bytes) -> Response:
    if not docx_data or len(docx_data) > MAX_PREVIEW_DOCX_BYTES:
        raise HTTPException(413, "حجم مستند Word كبير جدًا للمعاينة؛ حاول اختصار المحتوى.")
    try:
        with tempfile.TemporaryDirectory(prefix="maghrabi-word-preview-") as directory:
            folder = Path(directory)
            input_path = folder / "document.docx"
            output_path = folder / "document.pdf"
            profile = (folder / "lo-profile").as_uri()
            input_path.write_bytes(docx_data)
            cmd = [
                "soffice",
                f"-env:UserInstallation={profile}",
                "--headless",
                "--nodefault",
                "--nofirststartwizard",
                "--norestore",
                "--convert-to",
                "pdf:writer_pdf_Export",
                "--outdir",
                str(folder),
                str(input_path),
            ]
            result = subprocess.run(
                cmd,
                cwd=str(folder),
                capture_output=True,
                timeout=PREVIEW_TIMEOUT_SECONDS,
                check=False,
                env={**os.environ, "HOME": str(folder), "SAL_USE_VCLPLUGIN": "svp"},
            )
            if result.returncode != 0 or not output_path.is_file():
                raise HTTPException(
                    502, "تعذر إنشاء معاينة Word حاليًا. جرّب التنزيل أو أعد المحاولة."
                )
            if output_path.stat().st_size > MAX_PREVIEW_PDF_BYTES:
                raise HTTPException(413, "عدد الصور أو حجم المستند أكبر من الحد المسموح للمعاينة.")
            pdf_data = output_path.read_bytes()
            with fitz.open(stream=pdf_data, filetype="pdf") as pdf:
                pages = len(pdf)
                if not pages or pages > MAX_PREVIEW_PAGES:
                    raise HTTPException(
                        413, "المعاينة تدعم المستندات حتى 80 صفحة. يمكنك تنزيل Word مباشرة."
                    )
            return Response(
                pdf_data,
                media_type="application/pdf",
                headers={
                    "Cache-Control": "no-store, private",
                    "Pragma": "no-cache",
                    "Content-Disposition": 'inline; filename="MAGHRABI-preview.pdf"',
                    "X-Preview-Pages": str(pages),
                    "X-Content-Type-Options": "nosniff",
                },
            )
    except FileNotFoundError as exc:
        raise HTTPException(503, "محرّك معاينة الصفحات غير متاح في الخادم.") from exc
    except subprocess.TimeoutExpired as exc:
        raise HTTPException(504, "استغرقت معاينة المستند وقتًا طويلًا؛ حاول تقليل عدد الصفحات.") from exc
    except HTTPException:
        raise
    except (OSError, ValueError, RuntimeError) as exc:
        raise HTTPException(502, "تعذر قراءة معاينة المستند. تحقق من المحتوى وأعد المحاولة.") from exc
