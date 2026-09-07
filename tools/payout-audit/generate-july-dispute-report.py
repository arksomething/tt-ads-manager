#!/usr/bin/env python3
"""Generate the July three-claim payment investigation report."""

from __future__ import annotations

import csv
import html
import json
import shutil
from pathlib import Path
from typing import Any, Iterable

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    KeepTogether,
    LongTable,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)


ROOT = Path("/home/ark296/projects/tt-ads-manager")
OUT = ROOT / "payouts/2026-07/disputes/2026-08-12-michael-three-claims"
LIVE_PATH = OUT / "live-and-local-evidence.json"
CLUB_PATH = OUT / "clubgrowth-instagram-public-evidence.json"
PDF_PATH = OUT / "july-payment-dispute-investigation.pdf"
MD_PATH = OUT / "REPORT.md"
INVOICE_SOURCE = ROOT / "tmp/pdfs/invoice-july.pdf"
INVOICE_COPY = OUT / "source-michael-clubgrowth-invoice-july.pdf"

NAVY = colors.HexColor("#13233A")
BLUE = colors.HexColor("#1F5A94")
PALE_BLUE = colors.HexColor("#EAF2FA")
GREEN = colors.HexColor("#16765A")
PALE_GREEN = colors.HexColor("#E8F5EF")
AMBER = colors.HexColor("#9A5B00")
PALE_AMBER = colors.HexColor("#FFF4D6")
RED = colors.HexColor("#A53434")
PALE_RED = colors.HexColor("#FBEAEA")
INK = colors.HexColor("#1E293B")
MUTED = colors.HexColor("#5F6B7A")
GRID = colors.HexColor("#CBD5E1")
LIGHT = colors.HexColor("#F6F8FB")


def load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def money(value: Any) -> str:
    return f"${float(value):,.2f}"


def number(value: Any, digits: int = 0) -> str:
    if value in (None, ""):
        return "-"
    return f"{float(value):,.{digits}f}"


def text(value: Any) -> str:
    return html.escape("" if value is None else str(value))


def paragraph(value: Any, style: ParagraphStyle) -> Paragraph:
    return Paragraph(text(value), style)


def linked_shortcode(shortcode: str, style: ParagraphStyle) -> Paragraph:
    url = f"https://www.instagram.com/reel/{shortcode}/"
    return Paragraph(
        f'<link href="{html.escape(url)}" color="#1F5A94">{html.escape(shortcode)}</link>',
        style,
    )


def find_creator(rows: Iterable[dict[str, Any]], handle: str) -> dict[str, Any]:
    return next(row for row in rows if row.get("TikTok handle") == handle)


def provider_account(rows: list[dict[str, Any]], username: str) -> dict[str, Any]:
    return next(row for row in rows if row.get("username") == username)


pdfmetrics.registerFont(
    TTFont("DejaVu", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf")
)
pdfmetrics.registerFont(
    TTFont("DejaVu-Bold", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf")
)
pdfmetrics.registerFont(
    TTFont("DejaVuMono", "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf")
)

styles = getSampleStyleSheet()
styles.add(
    ParagraphStyle(
        name="ReportTitle",
        fontName="DejaVu-Bold",
        fontSize=24,
        leading=29,
        textColor=NAVY,
        spaceAfter=6,
    )
)
styles.add(
    ParagraphStyle(
        name="ReportSubtitle",
        fontName="DejaVu",
        fontSize=10,
        leading=15,
        textColor=MUTED,
        spaceAfter=14,
    )
)
styles.add(
    ParagraphStyle(
        name="H1x",
        fontName="DejaVu-Bold",
        fontSize=15,
        leading=19,
        textColor=NAVY,
        spaceBefore=10,
        spaceAfter=7,
    )
)
styles.add(
    ParagraphStyle(
        name="H2x",
        fontName="DejaVu-Bold",
        fontSize=11,
        leading=14,
        textColor=BLUE,
        spaceBefore=8,
        spaceAfter=4,
    )
)
styles.add(
    ParagraphStyle(
        name="Bodyx",
        fontName="DejaVu",
        fontSize=8.6,
        leading=12.5,
        textColor=INK,
        spaceAfter=5,
    )
)
styles.add(
    ParagraphStyle(
        name="Smallx",
        fontName="DejaVu",
        fontSize=7.1,
        leading=9.6,
        textColor=INK,
    )
)
styles.add(
    ParagraphStyle(
        name="Tinyx",
        fontName="DejaVu",
        fontSize=6.2,
        leading=8,
        textColor=INK,
    )
)
styles.add(
    ParagraphStyle(
        name="TinyRight",
        parent=styles["Tinyx"],
        alignment=TA_RIGHT,
    )
)
styles.add(
    ParagraphStyle(
        name="TableHead",
        fontName="DejaVu-Bold",
        fontSize=6.7,
        leading=8.5,
        textColor=colors.white,
        alignment=TA_LEFT,
    )
)
styles.add(
    ParagraphStyle(
        name="TableHeadRight",
        parent=styles["TableHead"],
        alignment=TA_RIGHT,
    )
)
styles.add(
    ParagraphStyle(
        name="Callout",
        fontName="DejaVu-Bold",
        fontSize=10.5,
        leading=15,
        textColor=NAVY,
        alignment=TA_LEFT,
    )
)
styles.add(
    ParagraphStyle(
        name="MonoTiny",
        fontName="DejaVuMono",
        fontSize=5.7,
        leading=7.3,
        textColor=MUTED,
    )
)


def bullets(items: list[str]) -> list[Any]:
    result: list[Any] = []
    for item in items:
        result.append(
            Paragraph(
                f'<font color="#1F5A94">&#8226;</font> {item}',
                styles["Bodyx"],
            )
        )
    return result


def styled_table(
    data: list[list[Any]],
    widths: list[float],
    *,
    header: bool = True,
    repeat_rows: int = 1,
    font_size: float = 7.1,
) -> LongTable:
    table = LongTable(data, colWidths=widths, repeatRows=repeat_rows if header else 0)
    commands: list[tuple[Any, ...]] = [
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("GRID", (0, 0), (-1, -1), 0.35, GRID),
        ("FONTNAME", (0, 0), (-1, -1), "DejaVu"),
        ("FONTSIZE", (0, 0), (-1, -1), font_size),
        ("TEXTCOLOR", (0, 0), (-1, -1), INK),
    ]
    if header:
        commands.extend(
            [
                ("BACKGROUND", (0, 0), (-1, 0), NAVY),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("FONTNAME", (0, 0), (-1, 0), "DejaVu-Bold"),
            ]
        )
        body_start = 1
    else:
        body_start = 0
    for row in range(body_start, len(data)):
        if (row - body_start) % 2:
            commands.append(("BACKGROUND", (0, row), (-1, row), LIGHT))
    table.setStyle(TableStyle(commands))
    return table


def verdict_card(title: str, verdict: str, body: str, tone: str) -> Table:
    tone_map = {
        "green": (GREEN, PALE_GREEN),
        "amber": (AMBER, PALE_AMBER),
        "red": (RED, PALE_RED),
    }
    accent, fill = tone_map[tone]
    title_p = Paragraph(
        f'<font color="{accent.hexval()}">{html.escape(title)}</font>',
        styles["H2x"],
    )
    verdict_p = Paragraph(html.escape(verdict), styles["Callout"])
    body_p = Paragraph(body, styles["Bodyx"])
    table = Table([[title_p], [verdict_p], [body_p]], colWidths=[174 * mm])
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), fill),
                ("BOX", (0, 0), (-1, -1), 0.8, accent),
                ("LEFTPADDING", (0, 0), (-1, -1), 9),
                ("RIGHTPADDING", (0, 0), (-1, -1), 9),
                ("TOPPADDING", (0, 0), (-1, -1), 5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ]
        )
    )
    return table


def page_frame(canvas, doc) -> None:
    canvas.saveState()
    width, height = A4
    canvas.setStrokeColor(GRID)
    canvas.setLineWidth(0.4)
    canvas.line(18 * mm, 13 * mm, width - 18 * mm, 13 * mm)
    canvas.setFont("DejaVu", 6.5)
    canvas.setFillColor(MUTED)
    canvas.drawString(18 * mm, 8.5 * mm, "GoTall - July 2026 payment dispute investigation")
    canvas.drawRightString(width - 18 * mm, 8.5 * mm, f"Page {doc.page}")
    canvas.restoreState()


def build_markdown(live: dict[str, Any], club: dict[str, Any]) -> str:
    current_rows = live["receipt"]["creatorMatches"]
    adam = find_creator(current_rows, "adam.gotall")
    height = find_creator(current_rows, "7552076425029813262")
    stale = live["suppliedZipConsistency"]["stalePerCreatorRows"]
    stale_adam = find_creator(stale, "adam.gotall")
    height_account = provider_account(
        live["provider"]["relevantTikTokAccounts"], "heightpredictionguy"
    )
    summary = club["summary"]
    verified_club = summary["policyPayAt050CpmUsd"] + summary["providerOnlyPolicyPayAt050CpmUsd"]
    return f"""# July 2026 payment dispute investigation

Generated 2026-08-12. Scope: Michael Que's three claims about the supplied `gotall-july-final-v2` batch.

## Bottom line

Michael is right that Clubgrowth was omitted and right that HeightPredictionGuy's $0.30 is unsafe as a final payment. Adam's known discrepancy is already corrected in the final payment sheet, but the ZIP contains stale contradictory files that explain why it was questioned.

| Claim | Verdict | Amount / status |
|---|---|---|
| Clubgrowth was missed | Confirmed omission; invoice not fully valid | {money(verified_club)} supported for 37 provider-backed posts; 2 invoice posts unresolved. Invoice says {money(summary['invoiceStatedTotalUsd'])}, but its 38 rows add to {money(summary['invoiceRowsSumUsd'])}. |
| Adam has a discrepancy | Known discrepancy corrected in final sheet; actual transfer unverified | Final sheet and clean receipt: {money(adam['Total pay'])}. Stale creator file: {money(stale_adam['Total pay'])}. If the stale amount was paid, shortfall is {money(float(adam['Total pay']) - float(stale_adam['Total pay']))}. |
| HeightPredictionGuy got only $0.30 | Calculation matches incomplete inputs, not a reliable final | {height['Videos']} rows / {height['Payable views']} payable views / {money(height['Total pay'])}; tracker has {height_account['totalVideosTracked']} of {height_account['totalVideosPublished']} published videos and stops at {height_account['latestVideoPublishedAt'][:10]}. Final amount unknown pending backfill. |

## Payment action

1. Do not approve Clubgrowth's stated {money(summary['invoiceStatedTotalUsd'])} as-is. Confirm that `club.growth` is the payee identity for Instagram owner `influ.rx`, recover the two missing Reels, then rerun. The currently substantiated partial amount is {money(verified_club)}.
2. Check the payment processor for Adam. If {money(adam['Total pay'])} was sent, no additional Adam top-up is supported. If {money(stale_adam['Total pay'])} was sent, the supported top-up is {money(float(adam['Total pay']) - float(stale_adam['Total pay']))}.
3. Hold HeightPredictionGuy's final payment determination, repair/backfill the tracker using the real username `heightpredictionguy`, and rerun July. Do not treat {money(height['Total pay'])} as a final settled amount.
4. Record the actual transfers in the payout ledger. The live database currently has no payout records for Adam or HeightPredictionGuy and both campaign records remain `PENDING`.

## Clubgrowth findings

- All 38 invoice URLs resolve to Instagram owner `influ.rx`; all 38 captions promote GoTall.
- No Clubgrowth campaign creator exists. The clean receipt explicitly warns that `club.growth` could not be associated with a local creator.
- The invoice's 38 rows total {money(summary['invoiceRowsSumUsd'])}, not its stated {money(summary['invoiceStatedTotalUsd'])}.
- Historical provider data resolves 36 invoice rows at {money(summary['policyPayAt050CpmUsd'])} under the batch's $0.50 CPM / first-seven-day policy.
- Provider data contains one additional GoTall Reel omitted from the invoice worth {money(summary['providerOnlyPolicyPayAt050CpmUsd'])}.
- Two invoice Reels (`DadrCmERrf9`, `DadrWq9RSfJ`) are absent from both July analytics and tracked-video search. Their historical policy-window views cannot be recovered from current artifacts.
- Twelve invoice dates disagree with provider publication dates. The row-level CSV records every mismatch.

## Adam findings

- The supplied payment sheet and corrected audit receipt both say {money(adam['Total pay'])} across {adam['Videos']} videos.
- The ZIP also contains a stale creator CSV saying {money(stale_adam['Total pay'])} across {stale_adam['Videos']} videos. This internal contradiction is real.
- The Jul 10 video `7660857076297583905` was corrected from $0 to the exact $350 per-video cap. The corrected receipt records 1,985,946 gross views, 466,666.67 payable views, and $0.75 CPM.
- The latest clean rev2 receipt still reconciles Adam to {money(adam['Total pay'])}.
- No actual transfer can be verified from the application database.

## HeightPredictionGuy findings

- The $0.30 is mathematically correct for the captured dataset: {height['Videos']} videos and {height['Payable views']} payable views at the default $1 CPM.
- The captured dataset is not complete enough to settle payment: the live tracker is exactly at its 60-video cap while the account has {height_account['totalVideosPublished']} published videos, and its latest tracked publication is {height_account['latestVideoPublishedAt'][:10]}.
- All 13 receipt rows are old posts from Jun 26-29. The report contains no July posts for this creator.
- The local campaign account is stored under numeric handle `7552076425029813262`, while the provider's actual username is `heightpredictionguy`, which also caused the previous profile-completeness check to target the wrong handle.

## Evidence files

- `july-payment-dispute-investigation.pdf` - signed-off human report with row appendices.
- `clubgrowth-instagram-public-evidence.csv` - all 38 invoice rows, provider policy-window values, owner, dates, and failures.
- `clubgrowth-instagram-public-evidence.json` - same evidence plus provider-only and tracked-search records.
- `live-and-local-evidence.json` - hashes, ZIP contradictions, clean receipt rows, campaign/deal state, payout-ledger state, and live provider metadata.
- `source-michael-clubgrowth-invoice-july.pdf` - the invoice attached to Michael's Slack message.

This is a payment investigation, not a bank statement. The application has no settlement records for the disputed creators, so actual money sent must be confirmed in the external payment processor.
"""


def build_pdf(live: dict[str, Any], club: dict[str, Any]) -> None:
    current_rows = live["receipt"]["creatorMatches"]
    adam = find_creator(current_rows, "adam.gotall")
    height = find_creator(current_rows, "7552076425029813262")
    stale = live["suppliedZipConsistency"]["stalePerCreatorRows"]
    stale_adam = find_creator(stale, "adam.gotall")
    stale_height = find_creator(stale, "7552076425029813262")
    height_account = provider_account(
        live["provider"]["relevantTikTokAccounts"], "heightpredictionguy"
    )
    adam_account = provider_account(
        live["provider"]["relevantTikTokAccounts"], "adam.gotall"
    )
    club_summary = club["summary"]
    verified_club = (
        club_summary["policyPayAt050CpmUsd"]
        + club_summary["providerOnlyPolicyPayAt050CpmUsd"]
    )
    adam_shortfall = float(adam["Total pay"]) - float(stale_adam["Total pay"])
    verification = live["finalVerification"]

    doc = SimpleDocTemplate(
        str(PDF_PATH),
        pagesize=A4,
        leftMargin=18 * mm,
        rightMargin=18 * mm,
        topMargin=18 * mm,
        bottomMargin=18 * mm,
        title="July 2026 Payment Dispute Investigation",
        author="Codex payment audit",
        subject="Clubgrowth, Adam, and HeightPredictionGuy",
    )
    story: list[Any] = []

    story.append(Paragraph("July 2026 Payment Dispute Investigation", styles["ReportTitle"]))
    story.append(
        Paragraph(
            "Clubgrowth, Adam, and HeightPredictionGuy | Evidence reviewed through 2026-08-12",
            styles["ReportSubtitle"],
        )
    )
    story.append(
        verdict_card(
            "Overall conclusion",
            "Michael is substantially right, but only one of the three has a final supported number.",
            "Clubgrowth was omitted, but the submitted invoice is internally wrong and has two unreconciled rows. Adam's known discrepancy is corrected to $552.16 in the final sheet, although stale files remain in the ZIP. HeightPredictionGuy's $0.30 is the correct output for incomplete inputs and must not be treated as a final settlement.",
            "amber",
        )
    )
    story.append(Spacer(1, 8))

    anchor_data = [
        [
            paragraph("Artifact / state", styles["TableHead"]),
            paragraph("Total", styles["TableHeadRight"]),
            paragraph("Creators", styles["TableHeadRight"]),
            paragraph("Videos", styles["TableHeadRight"]),
            paragraph("Meaning", styles["TableHead"]),
        ],
        [
            paragraph("Supplied final-v2 payment sheet", styles["Smallx"]),
            paragraph("$9,807.90", styles["Smallx"]),
            paragraph("30", styles["TinyRight"]),
            paragraph("734", styles["TinyRight"]),
            paragraph("The batch Michael is referring to", styles["Smallx"]),
        ],
        [
            paragraph("Later clean rev2 receipt", styles["Smallx"]),
            paragraph(money(verification["receiptTotal"]), styles["Smallx"]),
            paragraph(str(verification["creators"]), styles["TinyRight"]),
            paragraph(str(verification["videos"]), styles["TinyRight"]),
            paragraph("Reference snapshot generated Aug 5; 30/30 reconciled", styles["Smallx"]),
        ],
        [
            paragraph("Live payout ledger", styles["Smallx"]),
            paragraph("No records", styles["Smallx"]),
            paragraph("-", styles["TinyRight"]),
            paragraph("-", styles["TinyRight"]),
            paragraph("Actual transfers cannot be confirmed in-app", styles["Smallx"]),
        ],
    ]
    story.append(styled_table(anchor_data, [43 * mm, 24 * mm, 18 * mm, 18 * mm, 71 * mm]))
    story.append(Paragraph("Decision matrix", styles["H1x"]))
    decision_data = [
        [
            paragraph("Claim", styles["TableHead"]),
            paragraph("Finding", styles["TableHead"]),
            paragraph("Supported amount / status", styles["TableHead"]),
            paragraph("Decision", styles["TableHead"]),
        ],
        [
            paragraph("Clubgrowth was missed", styles["Smallx"]),
            paragraph("Confirmed omission; invoice not fully valid", styles["Smallx"]),
            paragraph(f"{money(verified_club)} supported; 2 rows unresolved", styles["Smallx"]),
            paragraph("Hold final approval; map identity and recover 2 rows", styles["Smallx"]),
        ],
        [
            paragraph("Adam discrepancy", styles["Smallx"]),
            paragraph("Known issue corrected in final sheet; stale ZIP files conflict", styles["Smallx"]),
            paragraph(f"Final: {money(adam['Total pay'])}; stale: {money(stale_adam['Total pay'])}", styles["Smallx"]),
            paragraph("Verify actual transfer; top up only if less than $552.16", styles["Smallx"]),
        ],
        [
            paragraph("HeightPredictionGuy got $0.30", styles["Smallx"]),
            paragraph("Math is correct; source capture is incomplete", styles["Smallx"]),
            paragraph("Final amount unknown", styles["Smallx"]),
            paragraph("Hold and backfill; rerun July", styles["Smallx"]),
        ],
    ]
    story.append(styled_table(decision_data, [38 * mm, 53 * mm, 40 * mm, 43 * mm]))

    story.append(PageBreak())
    story.append(Paragraph("1. Clubgrowth / influ.rx", styles["H1x"]))
    story.append(
        verdict_card(
            "Verdict: omission confirmed; invoice amount not confirmed",
            f"The currently substantiated partial amount is {money(verified_club)}.",
            f"Thirty-six invoice posts support {money(club_summary['policyPayAt050CpmUsd'])}; one additional provider-backed GoTall Reel supports {money(club_summary['providerOnlyPolicyPayAt050CpmUsd'])}. Two submitted invoice posts have no historical provider row, so the final amount remains open.",
            "amber",
        )
    )
    story.append(Spacer(1, 6))
    story.extend(
        bullets(
            [
                "All 38 invoice URLs resolve. Every one is owned by Instagram account <b>influ.rx</b>, and all 38 captions promote GoTall.",
                "The campaign has no local Clubgrowth creator. The clean receipt explicitly warns: <i>Could not associate club.growth with a local creator record.</i>",
                f"The invoice states {money(club_summary['invoiceStatedTotalUsd'])}, but its 38 line items add to <b>{money(club_summary['invoiceRowsSumUsd'])}</b> - a {money(club_summary['invoiceStatedTotalUsd'] - club_summary['invoiceRowsSumUsd'])} arithmetic error.",
                f"Historical provider data resolves {club_summary['invoiceRowsResolvedInProvider']} invoice rows, {number(club_summary['providerFirstSevenDayJulyViewsTotal'])} first-seven-day July views, and {money(club_summary['policyPayAt050CpmUsd'])} after per-video cent rounding.",
                "Two invoice Reels - DadrCmERrf9 and DadrWq9RSfJ - return zero results in both July analytics and tracked-video search. Current public counters do not reconstruct historical first-seven-day views.",
                f"Provider data has one additional GoTall Reel missing from the invoice: DbRSS6kxnsE, {number(club_summary['providerOnlyFirstSevenDayJulyViewsTotal'])} policy-window views, {money(club_summary['providerOnlyPolicyPayAt050CpmUsd'])}.",
                f"Twelve invoice dates differ from provider publication dates. The row appendix records the exact comparisons.",
            ]
        )
    )
    story.append(Paragraph("Why it was omitted", styles["H2x"]))
    story.append(
        Paragraph(
            "This is an identity-mapping failure. viral.app tracks the TikTok identity club.growth and the Instagram identity influ.rx, but the payment campaign contains neither a Clubgrowth creator nor a mapping from influ.rx to that payee. The July batch therefore could not place those Instagram posts on a creator row.",
            styles["Bodyx"],
        )
    )
    story.append(Paragraph("Payment decision", styles["H2x"]))
    story.extend(
        bullets(
            [
                f"Do not approve the invoice's {money(club_summary['invoiceStatedTotalUsd'])} as-is.",
                "Confirm contract/payee identity: Clubgrowth must be explicitly linked to Instagram owner influ.rx.",
                "Recover the two missing Reels' historical first-seven-day data, include the provider-only Reel, and rerun the same $0.50 CPM policy.",
                f"Use {money(verified_club)} only as a supported partial subtotal, not a final settlement.",
            ]
        )
    )

    story.append(Paragraph("2. Adam", styles["H1x"]))
    story.append(
        verdict_card(
            "Verdict: the known discrepancy is corrected in the final batch sheet",
            f"Current supported July amount: {money(adam['Total pay'])}.",
            f"The supplied ZIP is internally inconsistent: its payment sheet and corrected receipt say {money(adam['Total pay'])} / {adam['Videos']} videos, while its stale per-creator CSV says {money(stale_adam['Total pay'])} / {stale_adam['Videos']} videos. That contradiction reasonably explains Michael's concern.",
            "green",
        )
    )
    story.append(Spacer(1, 6))
    adam_compare = [
        [
            paragraph("Adam source", styles["TableHead"]),
            paragraph("Videos", styles["TableHeadRight"]),
            paragraph("Payable views", styles["TableHeadRight"]),
            paragraph("Total", styles["TableHeadRight"]),
        ],
        [
            paragraph("Stale master / per-creator CSV", styles["Smallx"]),
            paragraph(stale_adam["Videos"], styles["TinyRight"]),
            paragraph(number(stale_adam["Payable views"]), styles["TinyRight"]),
            paragraph(money(stale_adam["Total pay"]), styles["TinyRight"]),
        ],
        [
            paragraph("Final-v2 sheet + corrected audit", styles["Smallx"]),
            paragraph(adam["Videos"], styles["TinyRight"]),
            paragraph(number(adam["Payable views"], 2), styles["TinyRight"]),
            paragraph(money(adam["Total pay"]), styles["TinyRight"]),
        ],
        [
            paragraph("Difference", styles["Smallx"]),
            paragraph(str(int(adam["Videos"]) - int(stale_adam["Videos"])), styles["TinyRight"]),
            paragraph(number(float(adam["Payable views"]) - float(stale_adam["Payable views"]), 2), styles["TinyRight"]),
            paragraph(money(adam_shortfall), styles["TinyRight"]),
        ],
    ]
    story.append(styled_table(adam_compare, [75 * mm, 24 * mm, 42 * mm, 33 * mm]))
    story.append(Spacer(1, 5))
    story.extend(
        bullets(
            [
                "The Jul 10 video 7660857076297583905 is the central correction: 1,985,946 gross views; 466,666.67 payable views; $0.75 CPM; exact $350 per-video cap. The stale receipt paid it $0.",
                f"The later clean rev2 receipt still resolves Adam to {money(adam['Total pay'])} and the same 22 videos.",
                f"Live provider metadata reaches Jul 28 and reports {adam_account['totalVideosTracked']} tracked of {adam_account['totalVideosPublished']} published videos. The clean receipt's 22 eligible July rows are internally reconciled.",
                "The application has no payout record for Adam and the campaign payout status is PENDING. This proves the calculation, not the external money transfer.",
            ]
        )
    )
    story.append(Paragraph("Payment decision", styles["H2x"]))
    story.append(
        Paragraph(
            f"Check the payment processor. If Adam received {money(adam['Total pay'])}, there is no supported additional top-up. If he received the stale {money(stale_adam['Total pay'])}, the supported shortfall is {money(adam_shortfall)}. For any other transfer, subtract the amount actually sent from {money(adam['Total pay'])}.",
            styles["Bodyx"],
        )
    )

    story.append(Paragraph("3. HeightPredictionGuy", styles["H1x"]))
    story.append(
        verdict_card(
            "Verdict: $0.30 is not a trustworthy final payment",
            "The number is mathematically correct for incomplete inputs; the final July amount is unknown.",
            f"The clean receipt has {height['Videos']} rows, {height['Payable views']} payable views, and {money(height['Total pay'])} at the default $1 CPM. The live tracker is exactly at its {height_account['maxVideos']}-video cap, has only {height_account['totalVideosTracked']} of {height_account['totalVideosPublished']} published videos, and its last tracked publication is {height_account['latestVideoPublishedAt'][:10]}.",
            "red",
        )
    )
    story.append(Spacer(1, 6))
    height_compare = [
        [
            paragraph("HeightPredictionGuy source", styles["TableHead"]),
            paragraph("Videos", styles["TableHeadRight"]),
            paragraph("Payable views", styles["TableHeadRight"]),
            paragraph("Total", styles["TableHeadRight"]),
        ],
        [
            paragraph("Stale per-creator CSV", styles["Smallx"]),
            paragraph(stale_height["Videos"], styles["TinyRight"]),
            paragraph(number(stale_height["Payable views"]), styles["TinyRight"]),
            paragraph(money(stale_height["Total pay"]), styles["TinyRight"]),
        ],
        [
            paragraph("Final-v2 / clean rev2 receipt", styles["Smallx"]),
            paragraph(height["Videos"], styles["TinyRight"]),
            paragraph(number(height["Payable views"]), styles["TinyRight"]),
            paragraph(money(height["Total pay"]), styles["TinyRight"]),
        ],
        [
            paragraph("Live tracking coverage", styles["Smallx"]),
            paragraph(f"{height_account['totalVideosTracked']} tracked", styles["TinyRight"]),
            paragraph(f"{height_account['totalVideosPublished']} published", styles["TinyRight"]),
            paragraph("Incomplete", styles["TinyRight"]),
        ],
    ]
    story.append(styled_table(height_compare, [75 * mm, 30 * mm, 36 * mm, 33 * mm]))
    story.append(Spacer(1, 5))
    story.extend(
        bullets(
            [
                "All 13 payment rows are posts dated Jun 26-29; no July publication appears in the receipt.",
                f"The provider refreshed analytics on {height_account['analyticsLatestLoadAt'][:10]}, but the newest tracked publication still reports {height_account['latestVideoPublishedAt'][:10]}. This is a coverage failure, not merely stale counters.",
                "The campaign stores the numeric handle 7552076425029813262, while the provider's real username is heightpredictionguy. The previous completeness checker therefore attempted the wrong public profile identity.",
                "The application has no payout record and the campaign payout status remains PENDING.",
            ]
        )
    )
    story.append(Paragraph("Payment decision", styles["H2x"]))
    story.extend(
        bullets(
            [
                "Hold final settlement; do not use $0.30 as a complete July obligation.",
                "Raise/remove the 60-video tracking cap or backfill the full account history, repair the local handle mapping, and rerun July using the same first-seven-day rules.",
                "Only the rerun can establish the final payment or top-up.",
            ]
        )
    )

    story.append(Paragraph("Required closeout sequence", styles["H1x"]))
    closeout_data = [
        [
            paragraph("Priority", styles["TableHead"]),
            paragraph("Owner action", styles["TableHead"]),
            paragraph("Close condition", styles["TableHead"]),
        ],
        [
            paragraph("1", styles["Smallx"]),
            paragraph("Confirm Clubgrowth = influ.rx payee identity and recover 2 missing Reels", styles["Smallx"]),
            paragraph("39-post universe reconciles under one policy run", styles["Smallx"]),
        ],
        [
            paragraph("2", styles["Smallx"]),
            paragraph("Check Adam's actual payment processor transfer", styles["Smallx"]),
            paragraph("Transfer equals $552.16, or documented top-up closes gap", styles["Smallx"]),
        ],
        [
            paragraph("3", styles["Smallx"]),
            paragraph("Backfill HeightPredictionGuy and rerun", styles["Smallx"]),
            paragraph("No tracking-cap or profile-identity warning remains", styles["Smallx"]),
        ],
        [
            paragraph("4", styles["Smallx"]),
            paragraph("Write external transfers to payout ledger", styles["Smallx"]),
            paragraph("Auditable status, amount, date, and reference exist", styles["Smallx"]),
        ],
    ]
    story.append(styled_table(closeout_data, [18 * mm, 82 * mm, 74 * mm]))

    story.append(PageBreak())
    story.append(Paragraph("Appendix A - Clubgrowth invoice reconciliation", styles["H1x"]))
    story.append(
        Paragraph(
            "Provider pay uses each Reel's first seven calendar days that overlap July, at $0.50 CPM, with each video rounded to cents. Blank provider cells are unresolved. The final row is provider-backed but absent from the invoice.",
            styles["Bodyx"],
        )
    )
    club_rows = [
        [
            paragraph("#", styles["TableHeadRight"]),
            paragraph("Reel", styles["TableHead"]),
            paragraph("Invoice date", styles["TableHead"]),
            paragraph("Provider date", styles["TableHead"]),
            paragraph("Invoice $", styles["TableHeadRight"]),
            paragraph("7-day views", styles["TableHeadRight"]),
            paragraph("Policy $", styles["TableHeadRight"]),
            paragraph("Status", styles["TableHead"]),
        ]
    ]
    for row in club["rows"]:
        resolved = row.get("providerFirstSevenDayJulyViews") is not None
        date_match = row.get("providerPublishedDate") == row.get("invoiceDate")
        status = "matched" if resolved and date_match else "date mismatch" if resolved else "unresolved"
        club_rows.append(
            [
                paragraph(row["invoiceRow"], styles["TinyRight"]),
                linked_shortcode(row["shortcode"], styles["Tinyx"]),
                paragraph(row["invoiceDate"], styles["Tinyx"]),
                paragraph(row.get("providerPublishedDate") or "-", styles["Tinyx"]),
                paragraph(money(row["invoicePayUsd"]), styles["TinyRight"]),
                paragraph(number(row.get("providerFirstSevenDayJulyViews")), styles["TinyRight"]),
                paragraph(money(row["policyPayAt050CpmUsd"]) if resolved else "-", styles["TinyRight"]),
                paragraph(status, styles["Tinyx"]),
            ]
        )
    for row in club.get("providerOnlyRows", []):
        club_rows.append(
            [
                paragraph("-", styles["TinyRight"]),
                linked_shortcode(row["shortcode"], styles["Tinyx"]),
                paragraph("not invoiced", styles["Tinyx"]),
                paragraph(row["providerPublishedDate"], styles["Tinyx"]),
                paragraph("-", styles["TinyRight"]),
                paragraph(number(row["providerFirstSevenDayJulyViews"]), styles["TinyRight"]),
                paragraph(money(row["policyPayAt050CpmUsd"]), styles["TinyRight"]),
                paragraph("provider-only", styles["Tinyx"]),
            ]
        )
    story.append(
        styled_table(
            club_rows,
            [8 * mm, 31 * mm, 25 * mm, 25 * mm, 19 * mm, 23 * mm, 19 * mm, 24 * mm],
            font_size=6.2,
        )
    )

    story.append(PageBreak())
    story.append(Paragraph("Appendix B - Adam corrected line items", styles["H1x"]))
    adam_rows = [
        [
            paragraph("Posted", styles["TableHead"]),
            paragraph("TikTok video", styles["TableHead"]),
            paragraph("Gross", styles["TableHeadRight"]),
            paragraph("Payable", styles["TableHeadRight"]),
            paragraph("CPM", styles["TableHeadRight"]),
            paragraph("Pay", styles["TableHeadRight"]),
        ]
    ]
    for row in live["receipt"]["adamVideos"]:
        video_id = row["Video URL"].rstrip("/").split("/")[-1]
        adam_rows.append(
            [
                paragraph(row["Posted"], styles["Tinyx"]),
                paragraph(video_id, styles["MonoTiny"]),
                paragraph(number(row["Gross views"]), styles["TinyRight"]),
                paragraph(number(row["Payable views"], 2), styles["TinyRight"]),
                paragraph(money(row["CPM"]), styles["TinyRight"]),
                paragraph(money(row["Video pay"]), styles["TinyRight"]),
            ]
        )
    adam_rows.append(
        [
            paragraph("TOTAL", styles["Smallx"]),
            paragraph(f"{adam['Videos']} videos", styles["Smallx"]),
            paragraph(number(adam["Gross views"]), styles["TinyRight"]),
            paragraph(number(adam["Payable views"], 2), styles["TinyRight"]),
            paragraph("-", styles["TinyRight"]),
            paragraph(money(adam["Total pay"]), styles["TinyRight"]),
        ]
    )
    story.append(styled_table(adam_rows, [25 * mm, 55 * mm, 28 * mm, 30 * mm, 18 * mm, 18 * mm]))

    story.append(Paragraph("Appendix C - HeightPredictionGuy captured line items", styles["H1x"]))
    height_rows = [
        [
            paragraph("Posted", styles["TableHead"]),
            paragraph("TikTok video", styles["TableHead"]),
            paragraph("Gross", styles["TableHeadRight"]),
            paragraph("Payable", styles["TableHeadRight"]),
            paragraph("Pay", styles["TableHeadRight"]),
        ]
    ]
    for row in live["receipt"]["heightPredictionGuyVideos"]:
        video_id = row["Video URL"].rstrip("/").split("/")[-1]
        height_rows.append(
            [
                paragraph(row["Posted"], styles["Tinyx"]),
                paragraph(video_id, styles["MonoTiny"]),
                paragraph(number(row["Gross views"]), styles["TinyRight"]),
                paragraph(number(row["Payable views"]), styles["TinyRight"]),
                paragraph(money(row["Video pay"]), styles["TinyRight"]),
            ]
        )
    height_rows.append(
        [
            paragraph("TOTAL", styles["Smallx"]),
            paragraph(f"{height['Videos']} videos", styles["Smallx"]),
            paragraph(number(height["Gross views"]), styles["TinyRight"]),
            paragraph(number(height["Payable views"]), styles["TinyRight"]),
            paragraph(money(height["Total pay"]), styles["TinyRight"]),
        ]
    )
    story.append(styled_table(height_rows, [27 * mm, 72 * mm, 27 * mm, 27 * mm, 21 * mm]))

    story.append(PageBreak())
    story.append(Paragraph("Appendix D - Evidence and limitations", styles["H1x"]))
    story.extend(
        bullets(
            [
                "Primary artifacts: supplied final-v2 ZIP, Michael's invoice-july.pdf, final-v2 payment sheet, corrected audit receipt, later clean rev2 receipt, live read-only campaign database, live viral.app account metadata and analytics, and Instagram embed metadata.",
                "Public Instagram embed counters are current public counters and differ materially from provider analytics; they were used to confirm URL ownership and GoTall captions, not historical pay.",
                "The later rev2 receipt is a correction/reference snapshot, not proof of what was sent in the supplied $9,807.90 batch.",
                "No application payout records exist for Adam or HeightPredictionGuy. External processor evidence is required to establish actual settlement.",
                "The report makes no final HeightPredictionGuy amount because missing tracked content cannot be safely estimated from account totals.",
            ]
        )
    )
    story.append(Spacer(1, 6))
    hashes = live["sourceHashes"]
    hash_data = [
        [paragraph("Source", styles["TableHead"]), paragraph("SHA-256", styles["TableHead"])],
        [paragraph("Supplied ZIP", styles["Tinyx"]), paragraph(hashes["suppliedZipSha256"], styles["MonoTiny"])],
        [paragraph("Michael invoice PDF", styles["Tinyx"]), paragraph(hashes["michaelInvoicePdfSha256"], styles["MonoTiny"])],
        [paragraph("Clean rev2 receipt", styles["Tinyx"]), paragraph(hashes["finalCleanReceiptSha256"], styles["MonoTiny"])],
        [paragraph("Clean verification", styles["Tinyx"]), paragraph(hashes["finalVerificationSha256"], styles["MonoTiny"])],
    ]
    story.append(styled_table(hash_data, [45 * mm, 129 * mm], font_size=6.0))
    story.append(Spacer(1, 7))
    story.append(
        Paragraph(
            "Prepared as an evidence-backed payment investigation. This report does not authorize a transfer and is not a bank statement.",
            styles["ReportSubtitle"],
        )
    )

    doc.build(story, onFirstPage=page_frame, onLaterPages=page_frame)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    if INVOICE_SOURCE.exists():
        shutil.copyfile(INVOICE_SOURCE, INVOICE_COPY)
    live = load_json(LIVE_PATH)
    club = load_json(CLUB_PATH)
    MD_PATH.write_text(build_markdown(live, club), encoding="utf-8")
    build_pdf(live, club)
    print(PDF_PATH)
    print(MD_PATH)


if __name__ == "__main__":
    main()
