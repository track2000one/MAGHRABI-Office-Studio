"""True PowerPoint rendering: generated PPTX -> LibreOffice PDF, with strict limits."""
from __future__ import annotations

from pathlib import Path
import os
import subprocess
import tempfile
from threading import BoundedSemaphore

import fitz
from fastapi import HTTPException
from fastapi.responses import Response

_MAX_PPTX = 16 * 1024 * 1024
_MAX_PDF = 28 * 1024 * 1024
_MAX_PAGES = 80
_TIMEOUT = 60
_SLOTS = BoundedSemaphore(2)


def render_presentation_preview(data: bytes) -> Response:
    if not data or len(data) > _MAX_PPTX:
        raise HTTPException(413, "حجم العرض أكبر من الحد المسموح للمعاينة.")
    if not _SLOTS.acquire(blocking=False):
        raise HTTPException(429, "خدمة معاينة PowerPoint مشغولة حاليًا.")
    try:
        with tempfile.TemporaryDirectory(prefix="maghrabi-slide-preview-") as directory:
            folder = Path(directory)
            source = folder / "presentation.pptx"
            pdf_path = folder / "presentation.pdf"
            source.write_bytes(data)
            command = [
                "soffice", f"-env:UserInstallation={(folder / 'lo-profile').as_uri()}",
                "--headless", "--nodefault", "--nofirststartwizard", "--norestore",
                "--convert-to", "pdf:impress_pdf_Export", "--outdir", str(folder),
                str(source),
            ]
            result = subprocess.run(
                command, cwd=str(folder), capture_output=True, timeout=_TIMEOUT,
                check=False, env={**os.environ, "HOME": str(folder), "SAL_USE_VCLPLUGIN": "svp"},
            )
            if result.returncode != 0 or not pdf_path.is_file():
                raise HTTPException(502, "تعذر إنشاء معاينة الشرائح الفعلية.")
            if pdf_path.stat().st_size > _MAX_PDF:
                raise HTTPException(413, "حجم معاينة العرض تجاوز الحد المسموح.")
            pdf_bytes = pdf_path.read_bytes()
            with fitz.open(stream=pdf_bytes, filetype="pdf") as pdf:
                count = len(pdf)
                if count < 1 or count > _MAX_PAGES:
                    raise HTTPException(413, "المعاينة تدعم حتى 80 شريحة.")
            return Response(
                pdf_bytes,
                media_type="application/pdf",
                headers={
                    "Cache-Control": "no-store, private",
                    "Pragma": "no-cache",
                    "Content-Disposition": 'inline; filename="MAGHRABI-slides-preview.pdf"',
                    "X-Preview-Pages": str(count),
                    "X-Content-Type-Options": "nosniff",
                },
            )
    except FileNotFoundError as exc:
        raise HTTPException(503, "LibreOffice غير متاح لإنشاء معاينة العرض.") from exc
    except subprocess.TimeoutExpired as exc:
        raise HTTPException(504, "تجاوزت معاينة العرض الوقت المسموح. قلل عدد الشرائح.") from exc
    except HTTPException:
        raise
    except (OSError, ValueError, RuntimeError) as exc:
        raise HTTPException(502, "تعذر عرض الشرائح. تحقق من المحتوى وأعد المحاولة.") from exc
    finally:
        _SLOTS.release()
