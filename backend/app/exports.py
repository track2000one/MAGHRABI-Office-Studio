"""Editable Office exports. Text stays text; oversized slide content is paginated."""
from io import BytesIO
import re
import textwrap
from docx import Document
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Inches as DocInches, Pt as DocPt
from docx.enum.text import WD_ALIGN_PARAGRAPH
from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.util import Inches, Pt
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.enum.shapes import MSO_SHAPE
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


def export_docx(content: Content) -> bytes:
    doc = Document()
    section = doc.sections[0]
    section.top_margin = section.bottom_margin = DocInches(.8)
    section.left_margin = section.right_margin = DocInches(.85)
    doc.styles['Normal'].font.name = 'Arial'
    doc.styles['Normal'].font.size = DocPt(12)
    doc.add_heading(content.title, 0)
    if content.summary:
        doc.add_paragraph(content.summary)
    for item in content.sections:
        doc.add_heading(item.title, 1)
        for body in item.body:
            doc.add_paragraph(body)
    for paragraph in doc.paragraphs:
        paragraph_style(paragraph, content.language == 'ar')
    output = BytesIO()
    doc.save(output)
    return output.getvalue()


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


def export_pptx(content: Content) -> bytes:
    deck = Presentation()
    deck.slide_width, deck.slide_height = Inches(13.333), Inches(7.5)
    rtl = content.language == 'ar'
    navy, teal, ink = '102A43', '0F8F91', '152B3C'

    def text(slide, value, x, y, w, h, size, color, bold=False):
        shape = slide.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h))
        tf = shape.text_frame
        tf.word_wrap = True
        tf.margin_left = tf.margin_right = Inches(.05)
        tf.vertical_anchor = MSO_ANCHOR.TOP
        for i, line in enumerate(value.split('\n')):
            p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
            p.text = line
            p.alignment = PP_ALIGN.RIGHT if rtl else PP_ALIGN.LEFT
            p._p.get_or_add_pPr().set('rtl', '1' if rtl else '0')
            p.space_after = Pt(8)
            for run in p.runs:
                run.font.name = 'Arial'
                run.font.size = Pt(size)
                run.font.bold = bold
                run.font.color.rgb = RGBColor.from_string(color)
        return shape

    cover = deck.slides.add_slide(deck.slide_layouts[6])
    cover.background.fill.solid()
    cover.background.fill.fore_color.rgb = RGBColor.from_string(navy)
    text(cover, content.title, .8, 1.2, 11.7, 2.3, 34, 'FFFFFF', True)
    text(cover, content.summary, .8, 3.9, 11.7, 2.3, 20, 'D6E6EE')
    for section in content.sections:
        # Fixed line budget also handles long unbroken strings without dropping text.
        lines = []
        for item in section.body:
            lines.extend(textwrap.wrap(item, width=66, break_long_words=True, break_on_hyphens=False) or [''])
        for offset in range(0, len(lines), 8):
            slide = deck.slides.add_slide(deck.slide_layouts[6])
            accent = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(12.55 if rtl else .55), Inches(.65), Inches(.07), Inches(.85))
            accent.fill.solid()
            accent.fill.fore_color.rgb = RGBColor.from_string(teal)
            accent.line.fill.background()
            title = section.title + ((' — تابع' if rtl else ' — continued') if offset else '')
            text(slide, title, .8, .55, 11.7, 1.35, 27, navy, True)
            text(slide, '\n'.join(lines[offset:offset + 8]), .8, 2.0, 11.7, 4.8, 20, ink)
            text(slide, str(len(deck.slides)), .8, 7, 11.7, .35, 11, teal)
            if section.notes:
                slide.notes_slide.notes_text_frame.text = section.notes
    output = BytesIO()
    deck.save(output)
    return output.getvalue()
