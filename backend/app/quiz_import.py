"""Extract existing multiple-choice questions from PDF/DOCX without AI.

Only reliably delimited four-option questions are accepted. An answer key is
optional and never fabricated; review UI must require explicit correct answers
before scoring. The file is handled in-memory without server-side persistence.
"""
from __future__ import annotations

from io import BytesIO
import re
from zipfile import BadZipFile, ZipFile

import fitz
from docx import Document
from fastapi import HTTPException
from pydantic import BaseModel, Field

MAX_UPLOAD = 8 * 1024 * 1024
MAX_PAGES = 80
MAX_QUESTIONS = 40
MAX_PASTED_CHARS = 100_000
MAX_XML_UNCOMPRESSED = 40 * 1024 * 1024

LETTER_INDEX = {
    "a": 0, "b": 1, "c": 2, "d": 3,
    "أ": 0, "ا": 0, "إ": 0, "آ": 0, "ب": 1, "ج": 2, "د": 3,
    "1": 0, "2": 1, "3": 2, "4": 3,
}
ARABIC_NUMBERS = str.maketrans("٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹", "01234567890123456789")
QUESTION = re.compile(
    r"^\s*(?:(?:Q(?:uestion)?|السؤال|سؤال|س)\s*[#:]?\s*)?"
    r"([0-9٠-٩۰-۹]{1,3})\s*[\).:\-–،]\s*(.+?)\s*$", re.I)
OPTION = re.compile(
    r"^\s*(?:([A-Da-dأاإآبجد])\s*[\).:\-–،]"
    r"|\(([A-Da-dأاإآبجد])\))\s*(.+?)\s*$")
INLINE_ANSWER = re.compile(
    r"^\s*(?:(?:correct\s+)?answer|correct\s+(?:option|choice)|الإجابة(?:\s+الصحيحة)?|الجواب|الحل)"
    r"\s*[:：=\-]\s*([A-Da-dأاإآبجد1-4])\s*[).]?\s*$", re.I)
KEY_START = re.compile(r"^(?:answer\s+key|answers?\s+sheet|مفتاح\s+الإجابات?|الإجابات\s+الصحيحة)\s*[:：]?$", re.I)
EXPLANATION = re.compile(r"^(?:explanation|rationale|الشرح|التفسير|السبب)\s*[:：]", re.I)
KEY_PAIR = re.compile(r"([0-9٠-٩۰-۹]{1,3})\s*[\).:\-=]\s*([A-Da-dأاإآبجد])\b",re.I)
CORRECT_MARKER = re.compile(r"(?:\s*[✓✔✅]\s*|\s*\(\s*correct\s*\)\s*)$", re.I)
SIMPLE_QUESTION = re.compile(r"[؟?]\s*$")


class ImportedQuestion(BaseModel):
    number: int = Field(ge=1)
    question: str
    options: list[str]
    correct_index: int | None
    source_page: int = Field(ge=1)


class ImportedQuestions(BaseModel):
    filename: str
    title: str
    questions: list[ImportedQuestion]
    skipped: int
    detected_answers: int
    warnings: list[str]
    pages: int


def _number(number: str) -> int:
    return int(number.translate(ARABIC_NUMBERS))


def _answer(label: str) -> int | None:
    return LETTER_INDEX.get(label.strip().lower())


def _lines(raw: bytes, filename: str) -> tuple[list[tuple[int,str]],int]:
    if not raw:
        raise HTTPException(400, "الملف فارغ.")
    if len(raw) > MAX_UPLOAD:
        raise HTTPException(413, "الحد الأقصى لملف الأسئلة هو 8 ميجابايت.")
    extension = filename.lower().rsplit(".", 1)[-1]
    if extension not in ("pdf", "docx"):
        raise HTTPException(415, "الملفات المدعومة لاستيراد الأسئلة هي PDF وDOCX فقط.")
    result: list[tuple[int,str]] = []
    if extension == "pdf":
        try:
            with fitz.open(stream=raw,filetype="pdf") as doc:
                if doc.needs_pass:
                    raise HTTPException(422, "ملفات PDF المحمية بكلمة مرور غير مدعومة.")
                if len(doc)>MAX_PAGES:
                    raise HTTPException(413, "الحد الأقصى للمستند هو 80 صفحة.")
                pages=len(doc)
                for page_number,page in enumerate(doc,1):
                    # Preserve actual lines; flattening whitespace destroys
                    # delimiters between questions and their four answers.
                    for text in page.get_text("text",sort=True).splitlines():
                        cleaned=" ".join(text.split())
                        if cleaned:
                            result.append((page_number,cleaned))
        except HTTPException:
            raise
        except (RuntimeError,ValueError,fitz.FileDataError) as exc:
            raise HTTPException(422, "تعذر قراءة ملف PDF أو استخراج نص أسئلته.") from exc
    else:
        try:
            with ZipFile(BytesIO(raw)) as archive:
                entries=archive.infolist()
                if (len(entries)>1500 or sum(x.file_size for x in entries)>MAX_XML_UNCOMPRESSED
                    or any(x.flag_bits & 1 for x in entries)
                    or "word/document.xml" not in archive.namelist()):
                    raise HTTPException(422,"ملف Word غير صالح أو محمي أو كبير جدًا.")
            document=Document(BytesIO(raw))
            # Keep paragraphs and table rows in document order.
            for block in document.iter_inner_content():
                if hasattr(block,"rows"):
                    for row in block.rows:
                        for cell in row.cells:
                            for paragraph in cell.paragraphs:
                                for text in paragraph.text.splitlines():
                                    if text.strip():
                                        result.append((1," ".join(text.split())))
                else:
                    for text in block.text.splitlines():
                        if text.strip():
                            result.append((1," ".join(text.split())))
            pages=1  # DOCX has no reliable printed-page mapping.
        except HTTPException:
            raise
        except (BadZipFile,ValueError,KeyError,RuntimeError) as exc:
            raise HTTPException(422,"تعذر قراءة ملف Word. احفظه بصيغة DOCX سليمة.") from exc
    if not result:
        raise HTTPException(422,"لم يتم العثور على نص قابل للاستخراج. استخدم ملفًا نصيًا بدل PDF المصور.")
    return result,pages


def _clean_pasted_line(text: str) -> str:
    """Remove common Markdown wrappers without rewriting question content."""
    text = text.strip()
    text = re.sub(r"^\s*(?:>\s*|[-*•]\s+|#{1,6}\s+)", "", text)
    # ChatGPT often uses **1. Question**, **A)** and **Answer: B**.
    text = re.sub(r"\*\*|__", "", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def parse_text_questions(text: str, title: str) -> ImportedQuestions:
    """Import a pasted ChatGPT answer without an AI provider request."""
    if not text or not text.strip():
        raise HTTPException(422, "الصق الأسئلة في المربع أولًا.")
    if len(text) > MAX_PASTED_CHARS:
        raise HTTPException(413, "عدد أحرف الأسئلة المنسوخة يتجاوز 100 ألف حرف.")
    heading = title.strip()[:160] or "اختبار منسوخ من ChatGPT"
    cleaned = [_clean_pasted_line(line) for line in text.splitlines()]
    lines = [(1, line) for line in cleaned if line and line not in ("```", "---")]
    if not lines:
        raise HTTPException(422, "لم يُعثر على أسئلة نصية في المحتوى المنسوخ.")
    return _parse_lines(lines, 1, heading, filename=heading + ".txt")


def parse_questions(raw: bytes, filename: str) -> ImportedQuestions:
    lines, pages = _lines(raw, filename)
    return _parse_lines(lines, pages, filename.rsplit(".", 1)[0][:160], filename=filename)


def _parse_lines(
    lines: list[tuple[int, str]], pages: int, title: str, *, filename: str
) -> ImportedQuestions:
    parsed: list[ImportedQuestion]=[]
    keys: dict[int,int]={}
    current_number: int | None=None
    current_text: list[str]=[]
    options: list[str]=[]
    option_labels: list[int]=[]
    current_answer: int | None=None
    current_page=1
    skipped=0
    in_key=False
    warnings: list[str]=[]

    def finish() -> None:
        nonlocal current_number,current_text,options,option_labels,current_answer,skipped
        if current_number is not None:
            if (current_text and len(options)==4 and option_labels==[0,1,2,3]
                and len(" ".join(current_text))<=1500
                and all(0<len(value)<=750 for value in options)):
                parsed.append(ImportedQuestion(
                    number=current_number, question=" ".join(current_text).strip(),
                    options=options[:],correct_index=current_answer,source_page=current_page,
                ))
            else:
                skipped+=1
        current_number=None
        current_text=[]
        options=[]
        option_labels=[]
        current_answer=None

    for page_number,text in lines:
        if KEY_START.fullmatch(text):
            finish()
            in_key=True
            continue
        if EXPLANATION.match(text):
            continue  # Explanations are not additional answer choices.
        if in_key:
            for number,answer in KEY_PAIR.findall(text):
                idx=_answer(answer)
                if idx is not None:
                    keys[_number(number)]=idx
            continue
        match=QUESTION.match(text)
        if match:
            finish()
            current_number=_number(match.group(1))
            current_page=page_number
            current_text=[match.group(2)]
            continue
        # Headerless questions ending in ? can be imported as long as they
        # precede exactly four recognizable choice labels.
        opt=OPTION.match(text)
        if opt and current_number is not None:
            letter=_answer(opt.group(1) or opt.group(2))
            if letter is not None and letter not in option_labels:
                value=opt.group(3).strip()
                marked=bool(CORRECT_MARKER.search(value))
                value=CORRECT_MARKER.sub("",value).strip()
                option_labels.append(letter)
                options.append(value)
                if marked:
                    current_answer=letter
                continue
        inline=INLINE_ANSWER.match(text)
        if inline and current_number is not None:
            current_answer=_answer(inline.group(1))
            continue
        # Answer key lines at the end without an explicit heading:
        if current_number is None and len(text)<100:
            pairs=KEY_PAIR.findall(text)
            if len(pairs)>1:
                for number,answer in pairs:
                    value=_answer(answer)
                    if value is not None:
                        keys[_number(number)]=value
                continue
        if current_number is not None:
            if len(options)<4 and not options:
                current_text.append(text)
            elif options:
                options[-1]+=" "+text
        elif SIMPLE_QUESTION.search(text) and len(text)<1500:
            finish()
            current_number=len(parsed)+skipped+1
            current_page=page_number
            current_text=[text]
    finish()

    unique: list[ImportedQuestion]=[]
    seen:set[str]=set()
    for item in parsed:
        fingerprint=" ".join(item.question.casefold().split())
        if fingerprint in seen:
            skipped+=1
            continue
        seen.add(fingerprint)
        if item.correct_index is None:
            item.correct_index=keys.get(item.number)
        unique.append(item)
    if not unique:
        raise HTTPException(
            422, "لم أتعرف على أسئلة مكتملة بأربعة خيارات. تأكد من ترقيم السؤال والخيارات A-D أو أ-د، ثم أعد المحاولة."
        )
    if len(unique)>MAX_QUESTIONS:
        warnings.append("يُسمح باستيراد 40 سؤالًا في الاختبار الواحد؛ احتُفظ بأول 40 سؤالًا.")
        unique=unique[:MAX_QUESTIONS]
    if skipped:
        warnings.append(f"تعذر التعرف على {skipped} سؤال أو مقطع؛ راجع الملف قبل اعتماد الاختبار.")
    missing=sum(item.correct_index is None for item in unique)
    if missing:
        warnings.append(f"{missing} سؤالًا دون مفتاح إجابة؛ حدّد الإجابة الصحيحة يدويًا قبل بدء اختبار مصحّح.")
    return ImportedQuestions(
        filename=filename[:180],title=title,
        questions=unique,skipped=skipped,detected_answers=len(unique)-missing,
        warnings=warnings,pages=pages,
    )
