"""Editable Office exports. Text stays text; oversized slide content is paginated."""
from io import BytesIO
import re
from docx import Document
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Inches as DocInches, Pt as DocPt
from docx.enum.text import WD_ALIGN_PARAGRAPH
from .content import Content


def paragraph_style(paragraph, rtl=True):
    paragraph.alignment = WD_ALIGN_PARAGRAPH.RIGHT if rtl else WD_ALIGN_PARAGRAPH.LEFT
    paragraph.paragraph_format.space_after = DocPt(8)
    paragraph.paragraph_format.line_spacing = 1.3
    props = paragraph._p.get_or_add_pPr()
    bidi = props.find(qn('w:bidi'))
    if bidi is None:
        bidi = OxmlElement('w:bidi')
        props.insert_element_before(bidi, 'w:spacing', 'w:ind', 'w:jc')
    bidi.set(qn('w:val'), '1' if rtl else '0')
    if rtl:
        # Logical start aligns RTL to the right across Word and LibreOffice.
        props.find(qn('w:jc')).set(qn('w:val'), 'start')
    for run in paragraph.runs:
        run.font.name = 'Arial'
        run.font.complex_script = rtl
        fonts = run._r.get_or_add_rPr().rFonts
        if fonts is not None:
            fonts.set(qn('w:cs'), 'Arial')


def export_docx(content: Content, design_style: str = "luxury") -> bytes:
    """Premium fully editable DOCX output; retain legacy function/API entrypoint."""
    from .word_design import export_premium_docx
    return export_premium_docx(content, design_style)


def format_docx(data: bytes) -> bytes:
    doc = Document(BytesIO(data))
    # Touch run formatting only: preserve inline drawings, fields, links and tables.
    def walk(container):
        for paragraph in container.paragraphs:
            if re.search(r'[\u0600-\u06ff]', paragraph.text):
                paragraph_style(paragraph, True)
        for table in container.tables:
            for row in table.rows:
                for cell in row.cells:
                    walk(cell)
    walk(doc)
    output = BytesIO()
    doc.save(output)
    return output.getvalue()


def export_pptx(content: Content, design_style: str = "luxury") -> bytes:
    """Produce a brand-consistent, professional and completely editable deck."""
    from .presentation_design import export_premium_pptx
    return export_premium_pptx(content, design_style)
