#!/usr/bin/env python3
import json
import os
import shutil
import subprocess
import tempfile
import time
from pathlib import Path

import uno
from com.sun.star.beans import PropertyValue


ROOT = Path(__file__).resolve().parents[2]
SETTLEMENT_PATH = ROOT / "payouts/2026-08/final-settlement/settlement.json"
DISCORD_PATH = ROOT / "payouts/2026-08/final-settlement/discord-corrections-2026-09-03.json"
MOGG_PATH = ROOT / "payouts/2026-08/final-settlement/mogg3d-invoice-reconciliation.json"
OUTPUT_DIR = ROOT / "output/spreadsheets"
OUTPUT_PATH = OUTPUT_DIR / "michael-august-2026-payout-review.xlsx"
PREVIEW_PATH = ROOT / "tmp/pdfs/michael-august-2026-payout-review.pdf"

DARK_BLUE = 0x17365D
MID_BLUE = 0x1F4E78
TEAL = 0x0F6B78
LIGHT_BLUE = 0xD9EAF7
LIGHT_TEAL = 0xDDEBF7
LIGHT_GREEN = 0xE2F0D9
LIGHT_YELLOW = 0xFFF2CC
LIGHT_RED = 0xFCE4D6
LIGHT_GRAY = 0xE7E6E6
WHITE = 0xFFFFFF
BLACK = 0x000000
GRAY = 0x666666
GREEN = 0x008000
RED = 0xC00000


def prop(name, value):
    item = PropertyValue()
    item.Name = name
    item.Value = value
    return item


def border(color=0xB7C9D6, width=18):
    line = uno.createUnoStruct("com.sun.star.table.BorderLine2")
    line.Color = color
    line.LineWidth = width
    return line


def apply_border(cell_range, color=0xB7C9D6, width=18, bottom_only=False):
    line = border(color, width)
    if bottom_only:
        cell_range.BottomBorder = line
    else:
        cell_range.TopBorder = line
        cell_range.BottomBorder = line
        cell_range.LeftBorder = line
        cell_range.RightBorder = line


def format_range(cell_range, *, back=None, color=None, bold=None, size=None,
                 align=None, valign=2, wrap=None, number_format=None):
    cell_range.CharFontName = "Aptos"
    if back is not None:
        cell_range.CellBackColor = back
    if color is not None:
        cell_range.CharColor = color
    if bold is not None:
        cell_range.CharWeight = 150 if bold else 100
    if size is not None:
        cell_range.CharHeight = size
    if align is not None:
        cell_range.HoriJustify = align
    if valign is not None:
        cell_range.VertJustify = valign
    if wrap is not None:
        cell_range.IsTextWrapped = wrap
    if number_format is not None:
        cell_range.NumberFormat = number_format


def set_text(sheet, cell_name, value):
    sheet.getCellRangeByName(cell_name).String = str(value)


def set_value(sheet, cell_name, value):
    sheet.getCellRangeByName(cell_name).Value = float(value)


def set_formula(sheet, cell_name, formula):
    sheet.getCellRangeByName(cell_name).Formula = formula


def merge_title(sheet, target, title, subtitle=None):
    cell_range = sheet.getCellRangeByName(target)
    cell_range.merge(True)
    cell_range.getCellByPosition(0, 0).String = title
    format_range(cell_range, back=DARK_BLUE, color=WHITE, bold=True, size=18, align=0)
    cell_range.Rows.Height = 900
    if subtitle:
        start_row = cell_range.RangeAddress.EndRow + 1
        subtitle_range = sheet.getCellRangeByPosition(
            cell_range.RangeAddress.StartColumn,
            start_row,
            cell_range.RangeAddress.EndColumn,
            start_row,
        )
        subtitle_range.merge(True)
        subtitle_range.getCellByPosition(0, 0).String = subtitle
        format_range(subtitle_range, back=LIGHT_BLUE, color=DARK_BLUE, bold=True, size=10, align=0, wrap=True)
        subtitle_range.Rows.Height = 650


def add_section(sheet, target, label):
    cell_range = sheet.getCellRangeByName(target)
    cell_range.merge(True)
    cell_range.getCellByPosition(0, 0).String = label
    format_range(cell_range, back=MID_BLUE, color=WHITE, bold=True, size=11, align=0)
    cell_range.Rows.Height = 520


def add_header(sheet, target):
    cell_range = sheet.getCellRangeByName(target)
    format_range(cell_range, back=TEAL, color=WHITE, bold=True, size=9, align=2, wrap=True)
    apply_border(cell_range, color=0x8FA9BA, width=22)
    cell_range.Rows.Height = 800


def set_column_widths(sheet, widths):
    for index, width in enumerate(widths):
        sheet.Columns.getByIndex(index).Width = width


def set_page(doc, sheet, landscape=True):
    page_styles = doc.StyleFamilies.getByName("PageStyles")
    style = page_styles.getByName(sheet.PageStyle)
    if landscape and style.Width < style.Height:
        old_width = style.Width
        style.Width = style.Height
        style.Height = old_width
    style.IsLandscape = landscape
    style.LeftMargin = 700
    style.RightMargin = 700
    style.TopMargin = 700
    style.BottomMargin = 700
    style.HeaderIsOn = False
    style.FooterIsOn = False
    style.ScaleToPagesX = 1
    style.ScaleToPagesY = 0


def add_table_filter(doc, sheet, name, target):
    ranges = doc.DatabaseRanges
    if ranges.hasByName(name):
        ranges.removeByName(name)
    ranges.addNewByName(name, sheet.getCellRangeByName(target).RangeAddress)
    ranges.getByName(name).AutoFilter = True


def build_workbook(doc, settlement, discord_audit, mogg_audit):
    sheets = doc.Sheets
    summary = sheets.getByIndex(0)
    summary.Name = "Summary"
    for index, name in enumerate(
        ["Payment Review", "Corrections", "Mogg Detail", "Checks & Sources"], start=1
    ):
        sheets.insertNewByName(name, index)

    payment = sheets.getByName("Payment Review")
    corrections = sheets.getByName("Corrections")
    mogg_detail = sheets.getByName("Mogg Detail")
    checks = sheets.getByName("Checks & Sources")

    locale = uno.createUnoStruct("com.sun.star.lang.Locale")
    locale.Language = "en"
    locale.Country = "US"
    formats = doc.NumberFormats

    def number_format(pattern):
        key = formats.queryKey(pattern, locale, True)
        return key if key >= 0 else formats.addNew(pattern, locale)

    currency_fmt = number_format('$#,##0.00;[RED]($#,##0.00);-')
    integer_fmt = number_format('#,##0;[RED](#,##0);-')
    decimal_fmt = number_format('0.00;[RED](0.00);-')

    recipients = sorted(settlement["recipients"], key=lambda item: (-item["totalPay"], item["name"]))
    managed_names = {"Dobbingotall", "xCynu"}
    managed_total = round(sum(item["totalPay"] for item in recipients if item["name"] in managed_names), 2)
    other_total = round(settlement["totals"]["totalPay"] - managed_total, 2)
    audit_timestamp = discord_audit["auditedAt"]

    approved = {
        "Audrius_ma": "Approved in Discord",
        "Gotall.abdul": "Approved in Discord",
        "Scribi GoTall": "Approved in Discord",
        "gotallfinalboss": "Approved in Discord",
        "LowFRQ.tall": "Approved in Discord",
        "Will.GoTall": "Acknowledged in Discord",
    }
    no_channel = {"gotallash", "kneus", "Gar.213"}

    def review_outcome(recipient):
        name = recipient["name"]
        if name == "Mogg3d":
            return "Reconciled - no change"
        if name == "Mansuhn / heightmuncher67":
            return "Corrected +$5.01"
        if name in approved:
            return approved[name]
        if name in managed_names:
            return "No correction found"
        if name in no_channel:
            return "No Discord review channel"
        return "No correction raised"

    # Summary
    merge_title(
        summary,
        "A1:H1",
        "GoTall August 2026 Creator Payout Review",
        "REVIEW COPY - prepared for Michael, not yet sent | Period: August 1-31, 2026 (UTC)",
    )
    set_column_widths(summary, [3600, 2700, 2700, 800, 3600, 2700, 2700, 3600])
    add_section(summary, "A4:H4", "Payment totals")
    cards = [
        ("A5:B5", "A6:B7", "TOTAL TO SEND", settlement["totals"]["totalPay"], currency_fmt, LIGHT_GREEN),
        ("C5:D5", "C6:D7", "PAYMENT RECIPIENTS", settlement["totals"]["recipients"], integer_fmt, LIGHT_BLUE),
        ("E5:F5", "E6:F7", "MICHAEL-MANAGED SUBSET", managed_total, currency_fmt, LIGHT_YELLOW),
        ("G5:H5", "G6:H7", "OTHER RECIPIENTS", other_total, currency_fmt, LIGHT_TEAL),
    ]
    for label_target, value_target, label, value, fmt, fill in cards:
        label_range = summary.getCellRangeByName(label_target)
        label_range.merge(True)
        label_range.getCellByPosition(0, 0).String = label
        format_range(label_range, back=MID_BLUE, color=WHITE, bold=True, size=9, align=2)
        value_range = summary.getCellRangeByName(value_target)
        value_range.merge(True)
        value_range.getCellByPosition(0, 0).Value = float(value)
        format_range(value_range, back=fill, color=DARK_BLUE, bold=True, size=18, align=2, number_format=fmt)
        apply_border(value_range, color=0x9FBAD0, width=22)
    summary.getCellRangeByName("A5:H7").Rows.Height = 560

    add_section(summary, "A9:H9", "Review conclusions")
    conclusions = [
        ["Discord corrections", "1 actual payout correction found across 36 creator channels: Mansuhn +$5.01 to $20.44. No other correction was identified."],
        ["Mogg3d", "Use $1,614.43. His $1,488.00 invoice omitted 10 August posts and all 19 July carryovers; the $126.43 bridge ties exactly."],
        ["Scope", "All 23 settlement recipients are listed, including Dobbingotall and xCynu because this workbook is specifically for Michael to handle payments."],
        ["Transfer warning", "No payment-processor or bank transfer history was verified here. Amount to send assumes none of these August amounts has already been transferred."],
    ]
    for offset, (label, note) in enumerate(conclusions, start=10):
        set_text(summary, f"A{offset}", label)
        summary.getCellRangeByName(f"A{offset}:B{offset}").merge(True)
        summary.getCellRangeByName(f"C{offset}:H{offset}").merge(True)
        set_text(summary, f"C{offset}", note)
        format_range(summary.getCellRangeByName(f"A{offset}:B{offset}"), back=LIGHT_BLUE, color=DARK_BLUE, bold=True, size=10, align=0)
        format_range(summary.getCellRangeByName(f"C{offset}:H{offset}"), color=BLACK, size=10, align=0, wrap=True)
        apply_border(summary.getCellRangeByName(f"A{offset}:H{offset}"), color=0xD4DEE5, width=12)
        summary.Rows.getByIndex(offset - 1).Height = 900 if offset in (11, 13) else 720

    add_section(summary, "A16:H16", "File status")
    summary.getCellRangeByName("A17:B17").merge(True)
    summary.getCellRangeByName("C17:H17").merge(True)
    set_text(summary, "A17", "Discord audit as of")
    set_text(summary, "C17", audit_timestamp)
    summary.getCellRangeByName("A18:B18").merge(True)
    summary.getCellRangeByName("C18:H18").merge(True)
    set_text(summary, "A18", "Approval gate")
    set_text(summary, "C18", "Owner review required before sharing with Michael or initiating transfers")
    format_range(summary.getCellRangeByName("A17:B18"), back=LIGHT_GRAY, color=DARK_BLUE, bold=True, size=9, align=0)
    format_range(summary.getCellRangeByName("C17:H18"), back=LIGHT_YELLOW, color=RED, bold=True, size=9, align=0, wrap=True)
    summary.Rows.getByIndex(17).Height = 620

    # Payment Review
    merge_title(
        payment,
        "A1:K1",
        "August 2026 Creator Payment Review",
        "Amounts are settlement calculations, not transfer confirmations. Review before sending.",
    )
    set_column_widths(payment, [900, 4200, 4300, 1600, 1700, 1900, 1900, 2100, 5000, 2800, 3900])
    payment.getCellRangeByName("A4:B4").merge(True)
    set_text(payment, "A4", "Total to send")
    set_formula(payment, "C4", "=SUM(H7:H29)")
    payment.getCellRangeByName("D4:E4").merge(True)
    set_text(payment, "D4", "Recipients")
    set_formula(payment, "F4", "=COUNTA(B7:B29)")
    payment.getCellRangeByName("G4:H4").merge(True)
    set_text(payment, "G4", "Transfer verification")
    payment.getCellRangeByName("I4:K4").merge(True)
    set_text(payment, "I4", "NOT VERIFIED - review payment history before sending")
    format_range(payment.getCellRangeByName("A4:K4"), back=LIGHT_YELLOW, color=DARK_BLUE, bold=True, size=10, align=0, wrap=True)
    format_range(payment.getCellRangeByName("C4"), number_format=currency_fmt, align=3)
    format_range(payment.getCellRangeByName("F4"), number_format=integer_fmt, align=3)
    format_range(payment.getCellRangeByName("A4:C4"), back=LIGHT_GREEN)
    format_range(payment.getCellRangeByName("D4:F4"), back=LIGHT_BLUE)
    apply_border(payment.getCellRangeByName("A4:C4"), color=0x9FBAD0, width=18)
    apply_border(payment.getCellRangeByName("D4:F4"), color=0x9FBAD0, width=18)
    apply_border(payment.getCellRangeByName("G4:K4"), color=0xD6B656, width=18)
    headers = [
        "Rank", "Payment recipient", "Creator handles", "Aug posts", "July carryovers",
        "Fixed pay", "View pay", "Amount to send", "Review outcome", "Transfer state", "Payment handling",
    ]
    for col, header in enumerate(headers):
        payment.getCellByPosition(col, 5).String = header
    add_header(payment, "A6:K6")
    for index, recipient in enumerate(recipients, start=1):
        row = index + 6
        values = [
            index,
            recipient["name"],
            " / ".join(f"@{handle}" for handle in recipient.get("handles", [])),
            recipient["augustPosts"],
            recipient["julyCarryovers"],
            recipient["fixedPay"],
            recipient["cpmPay"],
            recipient["totalPay"],
            review_outcome(recipient),
            "Not verified",
            "Michael-managed" if recipient["name"] in managed_names else "Michael",
        ]
        for col, value in enumerate(values):
            cell = payment.getCellByPosition(col, row - 1)
            if isinstance(value, (int, float)):
                cell.Value = float(value)
            else:
                cell.String = str(value)
        fill = LIGHT_YELLOW if recipient["name"] in managed_names else WHITE
        if recipient["name"] == "Mansuhn / heightmuncher67":
            fill = LIGHT_GREEN
        if recipient["name"] == "Mogg3d":
            fill = LIGHT_BLUE
        format_range(payment.getCellRangeByName(f"A{row}:K{row}"), back=fill, color=BLACK, size=9, align=0, valign=2, wrap=True)
        format_range(payment.getCellRangeByName(f"A{row}:A{row}"), align=2, number_format=integer_fmt)
        format_range(payment.getCellRangeByName(f"D{row}:E{row}"), align=3, number_format=integer_fmt)
        format_range(payment.getCellRangeByName(f"F{row}:H{row}"), align=3, number_format=currency_fmt)
        apply_border(payment.getCellRangeByName(f"A{row}:K{row}"), color=0xD9E1E8, width=10, bottom_only=True)
        payment.Rows.getByIndex(row - 1).Height = 620 if recipient["name"] in {
            "Mogg3d",
            "Bledar - combined accounts",
            "Mansuhn / heightmuncher67",
            "Matthew - combined accounts",
        } else 520
    total_row = 30
    payment.getCellRangeByName(f"A{total_row}:E{total_row}").merge(True)
    set_text(payment, f"A{total_row}", "TOTAL")
    for col in "FGH":
        set_formula(payment, f"{col}{total_row}", f"=SUM({col}7:{col}29)")
    format_range(payment.getCellRangeByName(f"A{total_row}:K{total_row}"), back=DARK_BLUE, color=WHITE, bold=True, size=10, align=0)
    format_range(payment.getCellRangeByName(f"F{total_row}:H{total_row}"), align=3, number_format=currency_fmt)
    payment.Rows.getByIndex(total_row - 1).Height = 600
    add_table_filter(doc, payment, "PaymentReviewFilter", "A6:K29")

    # Corrections
    merge_title(
        corrections,
        "A1:H1",
        "Corrections and Reconciliation",
        "Only one Discord correction changed the settlement. Mogg3d's report was reconciled without an adjustment.",
    )
    set_column_widths(corrections, [3200, 4000, 2000, 2000, 2000, 2000, 2300, 5000])
    add_section(corrections, "A4:H4", "Discord correction - Mansuhn / heightmuncher67")
    correction_rows = [
        ["Issue", "12 talking @heightmuncher67 videos with literal #yap were left at $0.50 CPM", "", "", "", "", "", ""],
        ["Prior total", "", 15.43, "Increase", 5.01, "Corrected total", 20.44, "Corrected report sent in Discord"],
        ["Outcome", "Settlement updated; corrected report supersedes September 2 draft", "", "", "", "", "", ""],
    ]
    for row_index, values in enumerate(correction_rows, start=5):
        for col, value in enumerate(values):
            cell = corrections.getCellByPosition(col, row_index - 1)
            if isinstance(value, (int, float)):
                cell.Value = float(value)
            else:
                cell.String = value
        format_range(corrections.getCellRangeByName(f"A{row_index}:H{row_index}"), back=LIGHT_GREEN if row_index == 6 else WHITE, size=9, align=0, wrap=True)
        corrections.Rows.getByIndex(row_index - 1).Height = 760
    format_range(corrections.getCellRangeByName("C6:G6"), number_format=currency_fmt, align=3, bold=True)
    corrections.getCellRangeByName("B5:H5").merge(True)
    corrections.getCellRangeByName("B7:H7").merge(True)

    add_section(corrections, "A9:H9", "Mogg3d invoice reconciliation")
    mogg_rows = [
        ["Component", "Count", "Amount", "Change vs invoice", "Explanation", "", "", ""],
        ["Creator invoice", mogg_audit["invoice"]["rowCount"], mogg_audit["invoice"]["statedTotal"], 0, "108 linked August posts", "", "", ""],
        ["Settlement value of same posts", mogg_audit["invoice"]["matchedSettlementCount"], mogg_audit["reconciliation"]["matchedSettlementTotal"], mogg_audit["reconciliation"]["matchedCalculationDifference"], "Exact cents and frozen seven-day settlement values", "", "", ""],
        ["August posts omitted from invoice", mogg_audit["reconciliation"]["missingAugustPostCount"], mogg_audit["reconciliation"]["missingAugustPostTotal"], mogg_audit["reconciliation"]["missingAugustPostTotal"], "10 additional eligible August posts", "", "", ""],
        ["Eligible July carryovers", mogg_audit["reconciliation"]["julyCarryoverCount"], mogg_audit["reconciliation"]["julyCarryoverTotal"], mogg_audit["reconciliation"]["julyCarryoverTotal"], "August 1-4 portion of first seven days; no second fixed fee", "", "", ""],
        ["FINAL REPORT", mogg_audit["settlement"]["augustPosts"] + mogg_audit["settlement"]["julyCarryovers"], mogg_audit["settlement"]["totalPay"], mogg_audit["reconciliation"]["finalDifference"], "Use $1,614.43; no downward adjustment", "", "", ""],
    ]
    for row_index, values in enumerate(mogg_rows, start=10):
        for col, value in enumerate(values):
            cell = corrections.getCellByPosition(col, row_index - 1)
            if isinstance(value, (int, float)):
                cell.Value = float(value)
            else:
                cell.String = value
        corrections.getCellRangeByName(f"E{row_index}:H{row_index}").merge(True)
        fill = TEAL if row_index == 10 else (LIGHT_BLUE if row_index == 15 else WHITE)
        color = WHITE if row_index == 10 else BLACK
        format_range(corrections.getCellRangeByName(f"A{row_index}:H{row_index}"), back=fill, color=color, bold=row_index in (10, 15), size=9, align=0, wrap=True)
        format_range(corrections.getCellRangeByName(f"B{row_index}:B{row_index}"), number_format=integer_fmt, align=3)
        format_range(corrections.getCellRangeByName(f"C{row_index}:D{row_index}"), number_format=currency_fmt, align=3)
        apply_border(corrections.getCellRangeByName(f"A{row_index}:H{row_index}"), color=0xD9E1E8, width=10, bottom_only=True)
        corrections.Rows.getByIndex(row_index - 1).Height = 720
    add_section(corrections, "A17:H17", "Discord audit conclusion")
    corrections.getCellRangeByName("A18:H19").merge(True)
    set_text(
        corrections,
        "A18",
        f"Audited {len(discord_audit['allCreatorChannels'])} creator channels from {discord_audit['cutoff']} through {audit_timestamp}. Only the Mansuhn CPM issue changed payout math. Routine posting messages and approvals were not treated as corrections.",
    )
    format_range(corrections.getCellRangeByName("A18:H19"), back=LIGHT_YELLOW, color=DARK_BLUE, size=10, align=0, wrap=True)
    apply_border(corrections.getCellRangeByName("A18:H19"), color=0xD6B656, width=18)

    # Mogg detail
    merge_title(
        mogg_detail,
        "A1:I1",
        "Mogg3d Reconciliation Detail",
        "Items present in the settlement but absent from the creator's $1,488 invoice.",
    )
    set_column_widths(mogg_detail, [1800, 2800, 2600, 1300, 1700, 1700, 1700, 2100, 3500])
    detail_headers = ["Posted", "Video ID", "TikTok URL", "#yap", "Payable views", "Fixed pay", "View pay", "Settlement pay", "Category"]
    for col, header in enumerate(detail_headers):
        mogg_detail.getCellByPosition(col, 4).String = header
    add_header(mogg_detail, "A5:I5")
    detail_rows = []
    for row in mogg_audit["missingFromInvoice"]:
        detail_rows.append((row, "August post omitted from invoice"))
    for row in mogg_audit["julyCarryovers"]:
        detail_rows.append((row, "July carryover view pay"))
    detail_rows.sort(key=lambda item: (item[1], item[0]["publishedDate"], item[0]["videoId"]))
    for index, (item, category) in enumerate(detail_rows, start=6):
        values = [
            item["publishedDate"], item["videoId"], item["url"], "Yes" if item["hasYap"] else "No",
            item["payableViews"], item["fixedFee"], item["cpmPay"], item["settlementAmount"], category,
        ]
        for col, value in enumerate(values):
            cell = mogg_detail.getCellByPosition(col, index - 1)
            if col == 2:
                cell.Formula = f'=HYPERLINK("{value}";"Open video")'
            elif isinstance(value, (int, float)):
                cell.Value = float(value)
            else:
                cell.String = str(value)
        fill = LIGHT_BLUE if category.startswith("August") else WHITE
        format_range(mogg_detail.getCellRangeByName(f"A{index}:I{index}"), back=fill, size=8.5, align=0, wrap=True)
        format_range(mogg_detail.getCellRangeByName(f"E{index}:E{index}"), number_format=integer_fmt, align=3)
        format_range(mogg_detail.getCellRangeByName(f"F{index}:H{index}"), number_format=currency_fmt, align=3)
        apply_border(mogg_detail.getCellRangeByName(f"A{index}:I{index}"), color=0xD9E1E8, width=10, bottom_only=True)
        mogg_detail.Rows.getByIndex(index - 1).Height = 620
    detail_total_row = 6 + len(detail_rows)
    mogg_detail.getCellRangeByName(f"A{detail_total_row}:G{detail_total_row}").merge(True)
    set_text(mogg_detail, f"A{detail_total_row}", "TOTAL ITEMS OMITTED FROM INVOICE")
    set_formula(mogg_detail, f"H{detail_total_row}", f"=SUM(H6:H{detail_total_row - 1})")
    set_text(mogg_detail, f"I{detail_total_row}", "Plus $15.00 matched-row difference")
    format_range(mogg_detail.getCellRangeByName(f"A{detail_total_row}:I{detail_total_row}"), back=DARK_BLUE, color=WHITE, bold=True, size=9, align=0, wrap=True)
    format_range(mogg_detail.getCellRangeByName(f"H{detail_total_row}"), number_format=currency_fmt, align=3)
    mogg_detail.Rows.getByIndex(detail_total_row - 1).Height = 700
    add_table_filter(doc, mogg_detail, "MoggDetailFilter", f"A5:I{detail_total_row - 1}")

    # Checks & Sources
    merge_title(
        checks,
        "A1:G1",
        "Checks and Sources",
        "All amounts are USD. PASS means the workbook ties to the corrected settlement, not that transfers have occurred.",
    )
    set_column_widths(checks, [4600, 2300, 2300, 1900, 1500, 1800, 6000])
    add_section(checks, "A4:G4", "Workbook checks")
    check_headers = ["Check", "Actual", "Expected", "Difference", "Tolerance", "Status", "Notes"]
    for col, header in enumerate(check_headers):
        checks.getCellByPosition(col, 4).String = header
    add_header(checks, "A5:G5")
    checks_data = [
        ("Payment total ties to settlement", "='Payment Review'.H30", settlement["totals"]["totalPay"], "currency", "Sum of all 23 recipients"),
        ("Recipient count", "='Payment Review'.F4", settlement["totals"]["recipients"], "count", "One row per payment recipient"),
        ("Fixed plus view pay", "='Payment Review'.F30+'Payment Review'.G30", settlement["totals"]["totalPay"], "currency", "Component tie-out"),
        ("Mogg3d reconciliation bridge", "=1503+105.35+6.08", mogg_audit["settlement"]["totalPay"], "currency", "Invoice match + omitted posts + carryovers"),
        ("Mansuhn corrected amount", "=20.44", 20.44, "currency", "Includes $5.01 correction"),
        ("Michael-managed subtotal", "=1527.22+426.20", managed_total, "currency", "Dobbingotall plus xCynu"),
        ("Managed plus other recipients", f"={managed_total}+{other_total}", settlement["totals"]["totalPay"], "currency", "Scope tie-out"),
    ]
    for index, (label, actual_formula, expected, kind, note) in enumerate(checks_data, start=6):
        set_text(checks, f"A{index}", label)
        set_formula(checks, f"B{index}", actual_formula)
        set_value(checks, f"C{index}", expected)
        set_formula(checks, f"D{index}", f"=B{index}-C{index}")
        set_value(checks, f"E{index}", 0.005 if kind == "currency" else 0)
        set_formula(checks, f"F{index}", f'=IF(ABS(D{index})<=E{index};"PASS";"FAIL")')
        set_text(checks, f"G{index}", note)
        fill = LIGHT_GREEN
        format_range(checks.getCellRangeByName(f"A{index}:G{index}"), back=fill, size=9, align=0, wrap=True)
        if kind == "currency":
            format_range(checks.getCellRangeByName(f"B{index}:E{index}"), number_format=currency_fmt, align=3)
        else:
            format_range(checks.getCellRangeByName(f"B{index}:E{index}"), number_format=decimal_fmt, align=3)
        format_range(checks.getCellRangeByName(f"F{index}"), color=GREEN, bold=True, align=2)
        apply_border(checks.getCellRangeByName(f"A{index}:G{index}"), color=0xD9E1E8, width=10, bottom_only=True)
        checks.Rows.getByIndex(index - 1).Height = 850
    checks.getCellRangeByName("A14:E14").merge(True)
    set_text(checks, "A14", "MODEL STATUS")
    set_formula(checks, "F14", '=IF(COUNTIF(F6:F12;"FAIL")=0;"PASS";"FAIL")')
    set_text(checks, "G14", "Transfer history must be checked")
    format_range(checks.getCellRangeByName("A14:G14"), back=DARK_BLUE, color=WHITE, bold=True, size=10, align=0)
    format_range(checks.getCellRangeByName("F14"), align=2)

    add_section(checks, "A17:G17", "Source log")
    source_headers = ["Source", "As of", "Type", "Scope / value", "", "", "Notes"]
    for col, header in enumerate(source_headers):
        checks.getCellByPosition(col, 17).String = header
    checks.getCellRangeByName("D18:F18").merge(True)
    add_header(checks, "A18:G18")
    sources = [
        ("Corrected settlement", settlement["generatedAt"], "Frozen settlement", f"23 recipients; ${settlement['totals']['totalPay']:.2f}", "payouts/2026-08/final-settlement/settlement.json"),
        ("Discord correction audit", audit_timestamp, "Live Discord audit", "36 creator channels", "discord-corrections-2026-09-03.json; only Mansuhn changed payout math"),
        ("Mogg reconciliation", mogg_audit["generatedAt"], "Invoice reconciliation", "$1,488.00 to $1,614.43", "mogg3d-invoice-reconciliation.json; 108 short URLs resolved and matched"),
        ("Mansuhn Discord message", "2026-09-03", "Discord delivery", "$20.44 corrected report", "Message 1545007617821245521; corrected report sent and read back"),
        ("Mogg creator invoice", "2026-09-03", "Creator invoice", "$1,488.00", "User-supplied Invoice%20August.pdf.pdf; 108 rows"),
    ]
    for index, (source, as_of, source_type, scope, note) in enumerate(sources, start=19):
        set_text(checks, f"A{index}", source)
        set_text(checks, f"B{index}", as_of)
        set_text(checks, f"C{index}", source_type)
        checks.getCellRangeByName(f"D{index}:F{index}").merge(True)
        set_text(checks, f"D{index}", scope)
        set_text(checks, f"G{index}", note)
        format_range(checks.getCellRangeByName(f"A{index}:G{index}"), back=WHITE if index % 2 else LIGHT_BLUE, size=8.5, align=0, wrap=True)
        apply_border(checks.getCellRangeByName(f"A{index}:G{index}"), color=0xD9E1E8, width=10, bottom_only=True)
        checks.Rows.getByIndex(index - 1).Height = 920

    for sheet in [summary, payment, corrections, mogg_detail, checks]:
        set_page(doc, sheet, landscape=True)
        sheet.getCellRangeByName("A1:K200").CharFontName = "Aptos"

    controller = doc.CurrentController
    for sheet in [summary, payment, corrections, mogg_detail, checks]:
        controller.setActiveSheet(sheet)
        try:
            controller.ShowGrid = False
        except Exception:
            pass
    controller.setActiveSheet(payment)
    controller.freezeAtPosition(3, 6)
    controller.setActiveSheet(mogg_detail)
    controller.freezeAtPosition(3, 5)
    controller.setActiveSheet(checks)
    controller.freezeAtPosition(1, 5)
    controller.setActiveSheet(summary)

    return {
        "recipient_count": len(recipients),
        "total": settlement["totals"]["totalPay"],
        "managed_total": managed_total,
        "other_total": other_total,
        "audit_timestamp": audit_timestamp,
    }


def connect_office(port, profile_path):
    profile_url = uno.systemPathToFileUrl(str(profile_path))
    process = subprocess.Popen(
        [
            "libreoffice",
            "--headless",
            "--norestore",
            "--nodefault",
            "--nofirststartwizard",
            f"-env:UserInstallation={profile_url}",
            f"--accept=socket,host=127.0.0.1,port={port};urp;StarOffice.ServiceManager",
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    local_ctx = uno.getComponentContext()
    resolver = local_ctx.ServiceManager.createInstanceWithContext(
        "com.sun.star.bridge.UnoUrlResolver", local_ctx
    )
    for _ in range(60):
        try:
            ctx = resolver.resolve(
                f"uno:socket,host=127.0.0.1,port={port};urp;StarOffice.ComponentContext"
            )
            return process, ctx
        except Exception:
            time.sleep(0.25)
    process.terminate()
    raise RuntimeError("Could not connect to headless LibreOffice")


def main():
    settlement = json.loads(SETTLEMENT_PATH.read_text())
    discord_audit = json.loads(DISCORD_PATH.read_text())
    mogg_audit = json.loads(MOGG_PATH.read_text())
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    PREVIEW_PATH.parent.mkdir(parents=True, exist_ok=True)

    profile_dir = Path(tempfile.mkdtemp(prefix="gotall-payout-lo-"))
    port = 20831
    process = None
    doc = None
    try:
        process, ctx = connect_office(port, profile_dir)
        smgr = ctx.ServiceManager
        desktop = smgr.createInstanceWithContext("com.sun.star.frame.Desktop", ctx)
        doc = desktop.loadComponentFromURL("private:factory/scalc", "_blank", 0, ())
        metadata = build_workbook(doc, settlement, discord_audit, mogg_audit)
        doc.calculateAll()
        doc.storeAsURL(
            uno.systemPathToFileUrl(str(OUTPUT_PATH)),
            (prop("FilterName", "Calc MS Excel 2007 XML"), prop("Overwrite", True)),
        )
        doc.storeToURL(
            uno.systemPathToFileUrl(str(PREVIEW_PATH)),
            (prop("FilterName", "calc_pdf_Export"), prop("Overwrite", True)),
        )
        # Compact post-build checks from the live workbook.
        payment = doc.Sheets.getByName("Payment Review")
        checks = doc.Sheets.getByName("Checks & Sources")
        result = {
            **metadata,
            "xlsx": str(OUTPUT_PATH),
            "preview_pdf": str(PREVIEW_PATH),
            "payment_total_cell": payment.getCellRangeByName("H30").Value,
            "check_status": checks.getCellRangeByName("F14").String,
            "sheet_names": [doc.Sheets.getElementNames()[i] for i in range(doc.Sheets.Count)],
        }
        print(json.dumps(result, indent=2))
    finally:
        if doc is not None:
            doc.close(True)
        if process is not None:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
        shutil.rmtree(profile_dir, ignore_errors=True)


if __name__ == "__main__":
    main()
