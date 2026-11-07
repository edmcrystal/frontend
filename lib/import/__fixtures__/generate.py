"""Generates sample.pptx (and, via LibreOffice, sample.pdf) for importer tests.

Usage (from this directory):
    python3 generate.py
    soffice --headless --convert-to pdf sample.pptx
"""
import struct
import zlib

from pptx import Presentation
from pptx.chart.data import CategoryChartData
from pptx.dml.color import RGBColor
from pptx.enum.chart import XL_CHART_TYPE, XL_LEGEND_POSITION
from pptx.enum.shapes import MSO_SHAPE
from pptx.enum.text import PP_ALIGN
from pptx.oxml.ns import qn
from pptx.util import Inches, Pt


def png(w, h, color):
    raw = b"".join(b"\x00" + bytes(color) * w for _ in range(h))

    def chunk(t, d):
        return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)

    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw))
        + chunk(b"IEND", b"")
    )


with open("pic.png", "wb") as f:
    f.write(png(40, 30, (220, 80, 40)))

prs = Presentation()
prs.slide_width = Inches(13.333)
prs.slide_height = Inches(7.5)

# 1: title slide with notes
s = prs.slides.add_slide(prs.slide_layouts[0])
s.shapes.title.text = "Import Test Deck"
s.placeholders[1].text = "Generated with python-pptx"
s.notes_slide.notes_text_frame.text = "Speaker notes for the title slide."

# 2: bullets with levels + a numbered list
s = prs.slides.add_slide(prs.slide_layouts[1])
s.shapes.title.text = "Agenda"
tf = s.placeholders[1].text_frame
tf.text = "First point"
p = tf.add_paragraph()
p.text = "Sub point A"
p.level = 1
p = tf.add_paragraph()
p.text = "Sub point B"
p.level = 1
p = tf.add_paragraph()
p.text = "Second point"
p.level = 0
r = p.runs[0]
r.font.bold = True
r.font.color.rgb = RGBColor(0xC0, 0x20, 0x20)
tb = s.shapes.add_textbox(Inches(8.5), Inches(5.2), Inches(4), Inches(1.8))
tf2 = tb.text_frame
for i, t in enumerate(["Plan", "Build", "Ship"]):
    para = tf2.paragraphs[0] if i == 0 else tf2.add_paragraph()
    para.text = t
    pPr = para._p.get_or_add_pPr()
    pPr.set("marL", "342900")
    pPr.set("indent", "-342900")
    pPr.append(pPr.makeelement(qn("a:buAutoNum"), {"type": "arabicPeriod"}))
    para.runs[0].font.size = Pt(20)

# 3: picture, table with merged cells, rotated shape, outlined ellipse
s = prs.slides.add_slide(prs.slide_layouts[5])
s.shapes.title.text = "Picture, table, shape"
pic = s.shapes.add_picture("pic.png", Inches(0.6), Inches(1.8), Inches(3), Inches(2.25))
pic._element.nvPicPr.cNvPr.set("descr", "Orange block")
tbl = s.shapes.add_table(3, 3, Inches(4.2), Inches(1.8), Inches(5), Inches(1.5)).table
for r in range(3):
    for c in range(3):
        tbl.cell(r, c).text = f"R{r}C{c}"
tbl.cell(0, 0).merge(tbl.cell(0, 1))
tbl.cell(0, 0).text = "Merged header"
shp = s.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(10), Inches(2), Inches(2.5), Inches(1.2))
shp.rotation = 30
shp.fill.solid()
shp.fill.fore_color.rgb = RGBColor(0x10, 0xB9, 0x81)
shp.text_frame.text = "Rotated"
el = s.shapes.add_shape(MSO_SHAPE.OVAL, Inches(1), Inches(5), Inches(2), Inches(1.5))
el.fill.solid()
el.fill.fore_color.rgb = RGBColor(0x25, 0x63, 0xEB)
el.line.color.rgb = RGBColor(0, 0, 0)
el.line.width = Pt(3)

# 4: native charts
s = prs.slides.add_slide(prs.slide_layouts[5])
s.shapes.title.text = "Revenue chart"
cd = CategoryChartData()
cd.categories = ["Q1", "Q2", "Q3", "Q4"]
cd.add_series("Revenue", (1.2, 1.8, 2.1, 2.9))
cd.add_series("Target", (1.5, 1.7, 2.2, 2.6))
ch = s.shapes.add_chart(XL_CHART_TYPE.COLUMN_CLUSTERED, Inches(1), Inches(1.6), Inches(7), Inches(5), cd).chart
ch.has_legend = True
ch.legend.position = XL_LEGEND_POSITION.BOTTOM
ch.legend.include_in_layout = False
cd2 = CategoryChartData()
cd2.categories = ["A", "B", "C"]
cd2.add_series("Share", (50, 30, 20))
s.shapes.add_chart(XL_CHART_TYPE.PIE, Inches(8.5), Inches(1.6), Inches(4.3), Inches(4), cd2)

# 5: group + right-aligned italic text
s = prs.slides.add_slide(prs.slide_layouts[6])
grp = s.shapes.add_group_shape()
a = grp.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(2), Inches(2), Inches(3), Inches(2))
a.fill.solid()
a.fill.fore_color.rgb = RGBColor(0xF5, 0x9E, 0x0B)
b = grp.shapes.add_textbox(Inches(2.2), Inches(4.2), Inches(3), Inches(0.8))
b.text_frame.text = "Grouped caption"
c = grp.shapes.add_shape(MSO_SHAPE.ISOSCELES_TRIANGLE, Inches(6), Inches(2), Inches(2), Inches(2))
c.fill.solid()
c.fill.fore_color.rgb = RGBColor(0x8B, 0x5C, 0xF6)
t = s.shapes.add_textbox(Inches(8.5), Inches(1), Inches(4), Inches(1))
t.text_frame.text = "Right aligned"
t.text_frame.paragraphs[0].alignment = PP_ALIGN.RIGHT
t.text_frame.paragraphs[0].runs[0].font.size = Pt(28)
t.text_frame.paragraphs[0].runs[0].font.italic = True

prs.save("sample.pptx")
