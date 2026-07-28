"""Render DEFENCE_GUIDE.md as a PDF in Times New Roman.

Body text is Times New Roman 12pt justified, headings are bold, and tables carry a
light rule so a dense reference page stays readable. The real Windows font files are
registered rather than falling back to the PDF base fourteen, so the output is Times
New Roman rather than a metric-compatible substitute.

Deliberately simple markdown support, since the guide only uses headings, paragraphs,
bullets, block quotes, tables and inline bold or code.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_JUSTIFY, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (BaseDocTemplate, Frame, KeepTogether, PageBreak,
                                PageTemplate, Paragraph, Spacer, Table, TableStyle)

SRC = Path("DEFENCE_GUIDE.md")
OUT = Path("HoopIQ_Defence_Guide.pdf")
FONTS = Path("C:/Windows/Fonts")

INK = colors.HexColor("#1a1815")
MUTED = colors.HexColor("#5f5a52")
RULE = colors.HexColor("#c8c2b6")
BAND = colors.HexColor("#f2efe9")
ACCENT = colors.HexColor("#9a3412")


def register_fonts() -> tuple[str, str, str]:
    """Register Times New Roman, falling back to the base font if absent."""
    pairs = [("TimesNewRoman", "times.ttf"), ("TimesNewRoman-Bold", "timesbd.ttf"),
             ("TimesNewRoman-Italic", "timesi.ttf")]
    try:
        for name, filename in pairs:
            pdfmetrics.registerFont(TTFont(name, str(FONTS / filename)))
        pdfmetrics.registerFontFamily(
            "TimesNewRoman", normal="TimesNewRoman", bold="TimesNewRoman-Bold",
            italic="TimesNewRoman-Italic", boldItalic="TimesNewRoman-Bold")
        return "TimesNewRoman", "TimesNewRoman-Bold", "TimesNewRoman-Italic"
    except Exception as exc:                                   # pragma: no cover
        print(f"  Times New Roman unavailable ({exc}), using the PDF base font")
        return "Times-Roman", "Times-Bold", "Times-Italic"


BODY_F, BOLD_F, ITAL_F = register_fonts()

S = {
    "h1": ParagraphStyle("h1", fontName=BOLD_F, fontSize=18, leading=22,
                         textColor=INK, spaceBefore=0, spaceAfter=10),
    "h2": ParagraphStyle("h2", fontName=BOLD_F, fontSize=14.5, leading=18,
                         textColor=INK, spaceBefore=16, spaceAfter=7),
    "h3": ParagraphStyle("h3", fontName=BOLD_F, fontSize=12.5, leading=16,
                         textColor=INK, spaceBefore=12, spaceAfter=5),
    "body": ParagraphStyle("body", fontName=BODY_F, fontSize=12, leading=15.6,
                           textColor=INK, alignment=TA_JUSTIFY, spaceAfter=7),
    "bullet": ParagraphStyle("bullet", fontName=BODY_F, fontSize=12, leading=15.6,
                             textColor=INK, alignment=TA_LEFT, leftIndent=12,
                             bulletIndent=2, spaceAfter=3),
    "quote": ParagraphStyle("quote", fontName=BODY_F, fontSize=11.5, leading=15,
                            textColor=INK, alignment=TA_LEFT, leftIndent=10,
                            rightIndent=6, spaceBefore=4, spaceAfter=8),
    "cell": ParagraphStyle("cell", fontName=BODY_F, fontSize=9.5, leading=12,
                           textColor=INK, alignment=TA_LEFT),
    "cellh": ParagraphStyle("cellh", fontName=BOLD_F, fontSize=9.5, leading=12,
                            textColor=INK, alignment=TA_LEFT),
    "sub": ParagraphStyle("sub", fontName=ITAL_F, fontSize=11, leading=14.5,
                          textColor=MUTED, alignment=TA_LEFT, spaceAfter=10),
}


def inline(t: str) -> str:
    """Markdown emphasis and code to reportlab inline markup."""
    t = t.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    t = re.sub(r"\*\*(.+?)\*\*", rf'<font name="{BOLD_F}">\1</font>', t)
    t = re.sub(r"(?<!\*)\*([^*]+?)\*(?!\*)", rf'<font name="{ITAL_F}">\1</font>', t)
    t = re.sub(r"`(.+?)`", r'<font size="10.5">\1</font>', t)
    t = re.sub(r"\[(.+?)\]\((.+?)\)", r"\1", t)
    return t


def split_row(line: str) -> list[str]:
    return [c.strip() for c in line.strip().strip("|").split("|")]


def build_table(rows: list[list[str]], width: float) -> Table:
    head, body = rows[0], rows[1:]
    data = [[Paragraph(inline(c), S["cellh"]) for c in head]]
    data += [[Paragraph(inline(c), S["cell"]) for c in r] for r in body]
    n = len(head)
    # the first column carries the label and is given more room than the rest
    if n == 2:
        widths = [width * 0.42, width * 0.58]
    elif n == 3:
        widths = [width * 0.26, width * 0.30, width * 0.44]
    else:
        first = width * 0.22
        widths = [first] + [(width - first) / (n - 1)] * (n - 1)
    t = Table(data, colWidths=widths, repeatRows=1, hAlign="LEFT")
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), BAND),
        ("LINEBELOW", (0, 0), (-1, 0), 0.8, RULE),
        ("LINEBELOW", (0, 1), (-1, -2), 0.35, RULE),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
    ]))
    return t


def parse(md: str, width: float) -> list:
    flow: list = []
    lines = md.split("\n")
    i = 0
    para: list[str] = []

    def flush():
        nonlocal para
        if para:
            flow.append(Paragraph(inline(" ".join(para)), S["body"]))
            para = []

    while i < len(lines):
        ln = lines[i]
        s = ln.strip()

        if not s:
            flush()
            i += 1
            continue

        if s.startswith("|") and i + 1 < len(lines) and set(
                lines[i + 1].strip().replace("|", "").replace(" ", "")) <= {"-", ":"}:
            flush()
            rows = [split_row(s)]
            i += 2
            while i < len(lines) and lines[i].strip().startswith("|"):
                rows.append(split_row(lines[i]))
                i += 1
            flow.append(Spacer(1, 3))
            flow.append(build_table(rows, width))
            flow.append(Spacer(1, 9))
            continue

        if s.startswith("---"):
            flush()
            flow.append(Spacer(1, 5))
            i += 1
            continue

        if s.startswith("#"):
            flush()
            level = len(s) - len(s.lstrip("#"))
            text = s.lstrip("#").strip()
            key = {1: "h1", 2: "h2", 3: "h3"}.get(level, "h3")
            if key == "h2":
                flow.append(Spacer(1, 4))
            flow.append(Paragraph(inline(text), S[key]))
            i += 1
            continue

        if s.startswith(">"):
            flush()
            block = []
            while i < len(lines) and lines[i].strip().startswith(">"):
                block.append(lines[i].strip().lstrip(">").strip())
                i += 1
            joined = " ".join(x for x in block if x)
            para_q = Paragraph(inline(joined), S["quote"])
            tbl = Table([[para_q]], colWidths=[width], hAlign="LEFT")
            tbl.setStyle(TableStyle([
                ("BACKGROUND", (0, 0), (-1, -1), BAND),
                ("LINEBEFORE", (0, 0), (0, -1), 2, ACCENT),
                ("LEFTPADDING", (0, 0), (-1, -1), 9),
                ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ]))
            flow.append(tbl)
            flow.append(Spacer(1, 8))
            continue

        if s.startswith(("- ", "* ")):
            flush()
            flow.append(Paragraph(inline(s[2:]), S["bullet"], bulletText="\u2022"))
            i += 1
            continue

        para.append(s)
        i += 1

    flush()
    return flow


def main() -> int:
    md = SRC.read_text(encoding="utf-8")
    # the leading title and its subtitle are set outside the flow
    md = md.split("\n", 1)[1] if md.startswith("# ") else md

    left = right = 20 * mm
    top = 18 * mm
    bottom = 18 * mm
    width = A4[0] - left - right

    doc = BaseDocTemplate(str(OUT), pagesize=A4, leftMargin=left, rightMargin=right,
                          topMargin=top, bottomMargin=bottom,
                          title="HoopIQ Supervisor and Viva Defence Guide",
                          author="Nischay Maharjan")
    frame = Frame(left, bottom, width, A4[1] - top - bottom, id="body",
                  leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)

    def furniture(canvas, _doc):
        canvas.saveState()
        canvas.setFont(BODY_F, 9)
        canvas.setFillColor(MUTED)
        canvas.drawString(left, bottom - 9 * mm,
                          "HoopIQ  \u00b7  Supervisor and Viva Defence Guide")
        canvas.drawRightString(A4[0] - right, bottom - 9 * mm, str(canvas.getPageNumber()))
        canvas.setStrokeColor(RULE)
        canvas.setLineWidth(0.4)
        canvas.line(left, bottom - 6 * mm, A4[0] - right, bottom - 6 * mm)
        canvas.restoreState()

    doc.addPageTemplates([PageTemplate(id="main", frames=[frame], onPage=furniture)])

    flow = [
        Paragraph("HoopIQ", S["h1"]),
        Paragraph("Supervisor and Viva Defence Guide", S["h2"]),
        Paragraph("Design, Implementation and Assessment of a Predictive Model for "
                  "Basketball Shot Accuracy Using Statistical Inference and Machine "
                  "Learning Techniques on Publicly Available NBA Data", S["sub"]),
        Spacer(1, 4),
    ]
    flow += parse(md, width)

    doc.build(flow)
    print(f"  wrote {OUT.resolve()}")
    print(f"  body font {BODY_F} 12pt, headings {BOLD_F}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
