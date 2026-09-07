#!/usr/bin/env python3
"""Build the preliminary August 2026 payout correction for 3keviny.

This is intentionally a correction artifact rather than a settlement mutation:
the creator is present in Viral.app but absent from the campaign creator/deal
tables that produced the original August settlement.
"""

from __future__ import annotations

import csv
import hashlib
import json
from collections import Counter
from datetime import datetime, timezone
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT, TA_RIGHT
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfbase import pdfmetrics
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    KeepTogether,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)


ROOT = Path("/home/ark296/projects/tt-ads-manager")
SOURCE = ROOT / "payouts/2026-08/final-settlement/source/viral-august-window-results.json"
ANALYSIS = ROOT / "payouts/2026-08/final-settlement/source/viral-august-video-analysis.json"
CORRECTION_DIR = ROOT / "payouts/2026-08/corrections/3keviny"
OUTPUT_PDF = ROOT / "output/pdf/3keviny-august-2026-payout-report-preliminary.pdf"
ACCOUNT_ID = "7670222564590208014"
ORG_ACCOUNT_ID = "orgacc_EfrdSOmZA6bV"
HANDLE = "3keviny"


INK = colors.HexColor("#172033")
MUTED = colors.HexColor("#647086")
LINE = colors.HexColor("#D9E0EA")
SOFT = colors.HexColor("#F4F7FB")
BLUE = colors.HexColor("#2156D8")
BLUE_SOFT = colors.HexColor("#EAF0FF")
GREEN = colors.HexColor("#087C5A")
GREEN_SOFT = colors.HexColor("#E8F7F1")
ORANGE = colors.HexColor("#9A4C09")
ORANGE_SOFT = colors.HexColor("#FFF1DF")


def cents(value: Decimal) -> Decimal:
    return value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def money(value: Decimal | float | int) -> str:
    return f"${Decimal(str(value)):,.2f}"


def integer(value: int | float) -> str:
    return f"{int(value):,}"


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def choose_font() -> str:
    candidates = [
        Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
        Path("/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf"),
    ]
    for candidate in candidates:
        if candidate.exists():
            pdfmetrics.registerFont(TTFont("ReportSans", str(candidate)))
            return "ReportSans"
    return "Helvetica"


FONT = choose_font()


def build_rows() -> tuple[list[dict], dict]:
    windows = json.loads(SOURCE.read_text())
    analyses = json.loads(ANALYSIS.read_text())
    analysis_by_id = {str(row.get("platformVideoId")): row for row in analyses}
    rows = []
    for source in windows:
        if str(source.get("platformAccountId")) != ACCOUNT_ID:
            continue
        views = int(source.get("window", {}).get("views") or 0)
        tagged_yap = bool(source.get("hasYap"))
        cpm = Decimal("1.00") if tagged_yap else Decimal("0.50")
        cap = Decimal("300.00") if tagged_yap else Decimal("100.00")
        pay = min(cap, cents(Decimal(views) * cpm / Decimal(1000)))
        analysis = analysis_by_id.get(str(source.get("platformVideoId")), {})
        rows.append(
            {
                "publishedDate": source["publishedDate"],
                "platformVideoId": str(source["platformVideoId"]),
                "url": source["url"],
                "caption": source.get("caption") or "",
                "sourceTotalViews": int(source.get("viewCount") or 0),
                "windowFrom": source.get("window", {}).get("from"),
                "windowTo": source.get("window", {}).get("to"),
                "windowStatus": source.get("window", {}).get("status"),
                "windowSource": source.get("window", {}).get("source"),
                "eligibleWindowViews": views,
                "paidViewsDeducted": 0,
                "paidStatus": "unknown",
                "hasYap": tagged_yap,
                "classification": analysis.get("final") or "unavailable",
                "effectiveCpm": float(cpm),
                "perVideoCap": float(cap),
                "pay": float(pay),
            }
        )
    rows.sort(key=lambda row: (row["publishedDate"], row["platformVideoId"]))
    if len(rows) != 22:
        raise RuntimeError(f"Expected 22 August rows for {HANDLE}; found {len(rows)}")
    if any(row["windowStatus"] != "found" for row in rows):
        raise RuntimeError("Every report row must have a found payout window")

    total_pay = cents(sum((Decimal(str(row["pay"])) for row in rows), Decimal("0")))
    summary = {
        "videoCount": len(rows),
        "sourceTotalViews": sum(row["sourceTotalViews"] for row in rows),
        "eligibleWindowViews": sum(row["eligibleWindowViews"] for row in rows),
        "paidViewsDeducted": 0,
        "paidAttributionStatus": "unknown",
        "yapTaggedVideos": sum(row["hasYap"] for row in rows),
        "nonYapVideos": sum(not row["hasYap"] for row in rows),
        "talkingClassifiedVideos": sum(row["classification"] == "talking" for row in rows),
        "nonTalkingClassifiedVideos": sum(
            row["classification"] == "non-talking" for row in rows
        ),
        "windowSourceCounts": dict(Counter(row["windowSource"] for row in rows)),
        "preliminaryGrossPay": float(total_pay),
    }
    return rows, summary


def write_evidence(rows: list[dict], summary: dict) -> Path:
    CORRECTION_DIR.mkdir(parents=True, exist_ok=True)
    data_path = CORRECTION_DIR / "report-data.json"
    csv_path = CORRECTION_DIR / "videos.csv"
    payload = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "status": "creator_review_draft",
        "period": {"start": "2026-08-01", "end": "2026-08-31", "timezone": "UTC"},
        "creator": {
            "name": "Kevin Yalli",
            "handle": HANDLE,
            "platform": "tiktok",
            "platformAccountId": ACCOUNT_ID,
            "viralOrgAccountId": ORG_ACCOUNT_ID,
        },
        "identityEvidence": {
            "discordChannelId": "1534338489976619082",
            "discordChannelName": "3keviny",
            "discordUserId": "1500664040609939476",
            "discordUsername": "kevinyalli",
            "basis": "Discord channel submissions identify the creator as Kevin Yalli; Viral.app identifies the tracked account as @3keviny / Kevingotall.",
        },
        "terms": {
            "basis": "provisional_standard_talking_creator_terms",
            "reason": "The original campaign database has no creator/deal row for Kevin. The owner authorized the majority standard talking-creator terms used in the August settlement for this creator review draft.",
            "viewWindow": "first seven days intersecting August",
            "fixedFeePerVideo": 0,
            "yapCpm": 1,
            "yapPerVideoCpmCap": 300,
            "nonYapCpm": 0.5,
            "nonYapPerVideoCpmCap": 100,
            "deductPaidTraffic": True,
        },
        "coverage": {
            "viralTrackedAccountStatusCheckedAt": "2026-09-07T04:01:54.126Z",
            "viralTrackedVideos": 28,
            "viralPublishedVideos": 28,
            "viralLatestVideoPublishedAt": "2026-09-05T19:30:25.000Z",
            "viralAnalyticsLatestLoadAt": "2026-09-06T22:08:36.000Z",
            "viralLastError": None,
            "augustRows": len(rows),
            "windowsFound": len(rows),
        },
        "limitation": {
            "paidAdAttribution": "unknown",
            "detail": "The TikTok paid report returned unresolved post-backed ad groups and no exact matches for these 22 post IDs. This draft deducts zero paid views and may be reduced if exact paid delivery is later identified.",
            "isTransferProof": False,
        },
        "summary": summary,
        "videos": rows,
        "sources": {
            "viralWindowResults": str(SOURCE),
            "viralVideoAnalysis": str(ANALYSIS),
        },
    }
    data_path.write_text(json.dumps(payload, indent=2) + "\n")
    with csv_path.open("w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)
    return data_path


class ReportDocTemplate(BaseDocTemplate):
    def __init__(self, filename: str):
        super().__init__(
            filename,
            pagesize=landscape(A4),
            leftMargin=9 * mm,
            rightMargin=9 * mm,
            topMargin=10 * mm,
            bottomMargin=11 * mm,
            title="3keviny - August 2026 preliminary payout report",
            author="GoTall",
        )
        frame = Frame(
            self.leftMargin,
            self.bottomMargin,
            self.width,
            self.height,
            id="normal",
            leftPadding=0,
            rightPadding=0,
            topPadding=0,
            bottomPadding=0,
        )
        self.addPageTemplates([PageTemplate(id="main", frames=[frame], onPage=self._footer)])

    def _footer(self, canvas, doc):
        canvas.saveState()
        canvas.setStrokeColor(LINE)
        canvas.line(9 * mm, 8 * mm, landscape(A4)[0] - 9 * mm, 8 * mm)
        canvas.setFillColor(MUTED)
        canvas.setFont(FONT, 6.8)
        canvas.drawString(9 * mm, 4.7 * mm, "GoTall creator payout report - preliminary calculation, not proof of transfer")
        canvas.drawRightString(landscape(A4)[0] - 9 * mm, 4.7 * mm, f"Page {doc.page}")
        canvas.restoreState()


def p(text: str, style: ParagraphStyle) -> Paragraph:
    return Paragraph(text, style)


def build_pdf(rows: list[dict], summary: dict) -> None:
    OUTPUT_PDF.parent.mkdir(parents=True, exist_ok=True)
    styles = getSampleStyleSheet()
    body = ParagraphStyle(
        "body",
        parent=styles["BodyText"],
        fontName=FONT,
        fontSize=8,
        leading=10.5,
        textColor=INK,
        spaceAfter=0,
    )
    small = ParagraphStyle("small", parent=body, fontSize=6.5, leading=8, textColor=MUTED)
    table_text = ParagraphStyle("table", parent=body, fontSize=6.2, leading=7.4)
    table_num = ParagraphStyle(
        "table-num", parent=table_text, alignment=TA_RIGHT, wordWrap="LTR"
    )
    table_header = ParagraphStyle(
        "table-header", parent=table_text, textColor=colors.white
    )
    table_header_num = ParagraphStyle(
        "table-header-num", parent=table_header, alignment=TA_RIGHT, wordWrap="LTR"
    )
    eyebrow = ParagraphStyle(
        "eyebrow", parent=body, fontSize=7.5, leading=9, textColor=BLUE
    )
    title = ParagraphStyle(
        "title", parent=body, fontSize=22, leading=24, textColor=INK, spaceAfter=2
    )
    amount = ParagraphStyle(
        "amount", parent=body, fontSize=26, leading=28, textColor=GREEN, alignment=TA_RIGHT
    )
    amount_label = ParagraphStyle(
        "amount-label", parent=small, fontSize=7, alignment=TA_RIGHT
    )
    section = ParagraphStyle(
        "section", parent=body, fontSize=11, leading=13, textColor=INK, spaceBefore=8, spaceAfter=5
    )

    story = []
    header = Table(
        [
            [
                [p("GOTALL CREATOR PAYOUT REPORT", eyebrow), p("Kevin Yalli", title), p("@3keviny | August 1-31, 2026 | UTC", small)],
                [p(money(summary["preliminaryGrossPay"]), amount), p("CREATOR REVIEW DRAFT", amount_label)],
            ]
        ],
        colWidths=[190 * mm, 80 * mm],
    )
    header.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("ALIGN", (1, 0), (1, 0), "RIGHT"),
                ("LINEBELOW", (0, 0), (-1, -1), 1.5, INK),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
            ]
        )
    )
    story.extend([header, Spacer(1, 7)])

    stat_values = [
        ("Videos", integer(summary["videoCount"])),
        ("Source total views", integer(summary["sourceTotalViews"])),
        ("Payout-window views", integer(summary["eligibleWindowViews"])),
        ("Paid views deducted", "Unknown / 0 in draft"),
        ("#yap videos", integer(summary["yapTaggedVideos"])),
        ("Non-#yap videos", integer(summary["nonYapVideos"])),
    ]
    stat_cells = []
    for label, value in stat_values:
        stat_cells.append(
            [
                p(label.upper(), ParagraphStyle("stat-label-" + label, parent=small, fontSize=5.7, textColor=MUTED)),
                p(value, ParagraphStyle("stat-value-" + label, parent=body, fontSize=12.2, leading=14)),
            ]
        )
    stats = Table([stat_cells], colWidths=[45 * mm] * 6)
    stats.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), SOFT),
                ("BOX", (0, 0), (-1, -1), 0.6, LINE),
                ("INNERGRID", (0, 0), (-1, -1), 0.5, LINE),
                ("LEFTPADDING", (0, 0), (-1, -1), 7),
                ("RIGHTPADDING", (0, 0), (-1, -1), 7),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ]
        )
    )
    story.extend([stats, Spacer(1, 6)])

    deal_note = Table(
        [[p("<b>Provisional deal basis:</b> standard August talking-creator terms: $1.00 CPM when the literal #yap tag is present; otherwise $0.50 CPM. Per-video CPM caps are $300 with #yap and $100 without #yap. No fixed fee. Each row uses the first seven days intersecting August.", body)]],
        colWidths=[270 * mm],
    )
    deal_note.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), BLUE_SOFT),
                ("LINEBEFORE", (0, 0), (0, -1), 3, BLUE),
                ("BOX", (0, 0), (-1, -1), 0.4, LINE),
                ("LEFTPADDING", (0, 0), (-1, -1), 8),
                ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                ("TOPPADDING", (0, 0), (-1, -1), 7),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
            ]
        )
    )
    warning = Table(
        [[p("<b>Review note:</b> Kevin was missing from the campaign creator/deal database, so the standard August talking-creator terms were applied for this draft. TikTok paid-ad reporting also has unresolved post mappings; this draft deducts zero paid views. The $221.70 figure may change if different deal terms are confirmed or paid traffic is later matched.", body)]],
        colWidths=[270 * mm],
    )
    warning.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), ORANGE_SOFT),
                ("LINEBEFORE", (0, 0), (0, -1), 3, ORANGE),
                ("BOX", (0, 0), (-1, -1), 0.4, LINE),
                ("LEFTPADDING", (0, 0), (-1, -1), 8),
                ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                ("TOPPADDING", (0, 0), (-1, -1), 7),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
            ]
        )
    )
    coverage_note = Table(
        [[p("<b>Coverage:</b> Viral.app already tracks native account 7670222564590208014 as @3keviny / Kevingotall. The live account reports 28 of 28 published videos tracked with no provider error. All 22 August posts in the payout source have a found window value.", body)]],
        colWidths=[270 * mm],
    )
    coverage_note.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), GREEN_SOFT),
                ("LINEBEFORE", (0, 0), (0, -1), 3, GREEN),
                ("BOX", (0, 0), (-1, -1), 0.4, LINE),
                ("LEFTPADDING", (0, 0), (-1, -1), 8),
                ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                ("TOPPADDING", (0, 0), (-1, -1), 7),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
            ]
        )
    )
    story.extend([deal_note, Spacer(1, 4), warning, Spacer(1, 4), coverage_note])
    story.append(p("Per-video calculation", section))

    table_data = [
        [
            p("#", table_header_num),
            p("Posted", table_header),
            p("Video and caption", table_header),
            p("Source total", table_header_num),
            p("Window", table_header),
            p("Window views", table_header_num),
            p("#yap", table_header),
            p("CPM", table_header_num),
            p("Pay", table_header_num),
        ]
    ]
    for index, row in enumerate(rows, 1):
        caption = " ".join(row["caption"].split()).encode("ascii", "ignore").decode()
        if len(caption) > 86:
            caption = caption[:83] + "..."
        video = p(
            f'<link href="{row["url"]}" color="#2156D8"><b>{row["platformVideoId"]}</b></link><br/><font color="#647086">{caption}</font>',
            table_text,
        )
        table_data.append(
            [
                p(str(index), table_num),
                p(row["publishedDate"], table_text),
                video,
                p(integer(row["sourceTotalViews"]), table_num),
                p(f'{row["windowFrom"]}<br/>to {row["windowTo"]}', table_text),
                p(integer(row["eligibleWindowViews"]), table_num),
                p("Yes" if row["hasYap"] else "No", table_text),
                p(money(row["effectiveCpm"]), table_num),
                p(f'<b>{money(row["pay"])}</b>', table_num),
            ]
        )

    video_table = Table(
        table_data,
        colWidths=[7 * mm, 17 * mm, 98 * mm, 24 * mm, 31 * mm, 26 * mm, 14 * mm, 18 * mm, 19 * mm],
        repeatRows=1,
        hAlign="LEFT",
    )
    video_table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), INK),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("GRID", (0, 0), (-1, -1), 0.35, LINE),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#FAFBFE")]),
                ("LEFTPADDING", (0, 0), (-1, -1), 3.5),
                ("RIGHTPADDING", (0, 0), (-1, -1), 3.5),
                ("TOPPADDING", (0, 0), (-1, -1), 3.5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 3.5),
            ]
        )
    )
    story.append(video_table)
    story.extend(
        [
            Spacer(1, 6),
            KeepTogether(
                [
                    p(
                        "Method: per-video pay is rounded to cents. Source total views are the frozen Viral.app snapshot counters. Window views are each video's first seven days, clipped to August 1-31. No fixed fees are included. This calculation is not evidence that a transfer was made.",
                        small,
                    )
                ]
            ),
        ]
    )

    doc = ReportDocTemplate(str(OUTPUT_PDF))
    doc.build(story)


def main() -> None:
    rows, summary = build_rows()
    data_path = write_evidence(rows, summary)
    build_pdf(rows, summary)
    verification = {
        "verifiedAt": datetime.now(timezone.utc).isoformat(),
        "pdf": str(OUTPUT_PDF),
        "pdfSha256": sha256(OUTPUT_PDF),
        "reportData": str(data_path),
        "reportDataSha256": sha256(data_path),
        "sourceSha256": sha256(SOURCE),
        "videoCount": summary["videoCount"],
        "preliminaryGrossPay": summary["preliminaryGrossPay"],
    }
    (CORRECTION_DIR / "verification.json").write_text(
        json.dumps(verification, indent=2) + "\n"
    )
    print(json.dumps(verification, indent=2))


if __name__ == "__main__":
    main()
