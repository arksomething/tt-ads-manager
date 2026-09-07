#!/usr/bin/env python3
import json
import os
import shutil
import subprocess
import tempfile
import time
import zipfile
from pathlib import Path

import uno
from com.sun.star.beans import PropertyValue


ROOT = Path(__file__).resolve().parents[2]
SETTLEMENT_PATH = ROOT / "payouts/2026-08/final-settlement/settlement.json"
OUTPUT_PATH = ROOT / "output/spreadsheets/michael-august-2026-payout-review.xlsx"
PREVIEW_PATH = ROOT / "tmp/pdfs/michael-august-2026-payout-simple.pdf"


def prop(name, value):
    item = PropertyValue()
    item.Name = name
    item.Value = value
    return item


def connect_office(port, profile_path):
    process = subprocess.Popen(
        [
            "libreoffice",
            "--headless",
            "--norestore",
            "--nodefault",
            "--nofirststartwizard",
            f"-env:UserInstallation={uno.systemPathToFileUrl(str(profile_path))}",
            f"--accept=socket,host=127.0.0.1,port={port};urp;StarOffice.ServiceManager",
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    local_context = uno.getComponentContext()
    resolver = local_context.ServiceManager.createInstanceWithContext(
        "com.sun.star.bridge.UnoUrlResolver", local_context
    )
    for _ in range(60):
        try:
            context = resolver.resolve(
                f"uno:socket,host=127.0.0.1,port={port};urp;StarOffice.ComponentContext"
            )
            return process, context
        except Exception:
            time.sleep(0.25)
    process.terminate()
    raise RuntimeError("Could not connect to LibreOffice")


def border(color=0xD9E1E8, width=12):
    line = uno.createUnoStruct("com.sun.star.table.BorderLine2")
    line.Color = color
    line.LineWidth = width
    return line


def normalize_excel_currency_format(path):
    """Keep the amount cells numeric while forcing exactly one literal $ in Excel."""
    exported = b'formatCode="[$-409]\\$#,##0.00;[RED]&quot;($&quot;#,##0.00\\);\\-"'
    normalized = b'formatCode="&quot;$&quot;#,##0.00;[RED](&quot;$&quot;#,##0.00);-"'
    temporary_path = path.with_suffix(".normalized.xlsx")
    replacements = 0
    with zipfile.ZipFile(path, "r") as source, zipfile.ZipFile(
        temporary_path, "w", zipfile.ZIP_DEFLATED
    ) as destination:
        for item in source.infolist():
            data = source.read(item.filename)
            if item.filename == "xl/styles.xml":
                replacements = data.count(exported)
                data = data.replace(exported, normalized)
            destination.writestr(item, data)
    if replacements != 1:
        temporary_path.unlink(missing_ok=True)
        raise RuntimeError(
            f"Expected one exported currency format to normalize, found {replacements}"
        )
    os.replace(temporary_path, path)


def main():
    settlement = json.loads(SETTLEMENT_PATH.read_text())
    recipients = sorted(
        settlement["recipients"], key=lambda item: (-item["totalPay"], item["name"])
    )
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    PREVIEW_PATH.parent.mkdir(parents=True, exist_ok=True)

    profile = Path(tempfile.mkdtemp(prefix="gotall-simple-payout-"))
    process = None
    document = None
    try:
        process, context = connect_office(20832, profile)
        desktop = context.ServiceManager.createInstanceWithContext(
            "com.sun.star.frame.Desktop", context
        )
        document = desktop.loadComponentFromURL("private:factory/scalc", "_blank", 0, ())
        sheet = document.Sheets.getByIndex(0)
        sheet.Name = "Payouts"

        locale = uno.createUnoStruct("com.sun.star.lang.Locale")
        locale.Language = "en"
        locale.Country = "US"
        formats = document.NumberFormats
        pattern = '"$"#,##0.00;[RED]("$"#,##0.00);-'
        currency_format = formats.queryKey(pattern, locale, True)
        if currency_format < 0:
            currency_format = formats.addNew(pattern, locale)

        sheet.getCellRangeByName("A1").String = "Recipient"
        sheet.getCellRangeByName("B1").String = "Amount"
        header = sheet.getCellRangeByName("A1:B1")
        header.CellBackColor = 0x17365D
        header.CharColor = 0xFFFFFF
        header.CharWeight = 150
        header.CharHeight = 11
        header.CharFontName = "Aptos"
        header.Rows.Height = 650

        for index, recipient in enumerate(recipients, start=2):
            sheet.getCellByPosition(0, index - 1).String = recipient["name"]
            sheet.getCellByPosition(1, index - 1).Value = recipient["totalPay"]
            row_range = sheet.getCellRangeByName(f"A{index}:B{index}")
            row_range.CharFontName = "Aptos"
            row_range.CharHeight = 10
            row_range.Rows.Height = 560
            row_range.BottomBorder = border()
            sheet.getCellRangeByName(f"B{index}").NumberFormat = currency_format
            sheet.getCellRangeByName(f"B{index}").HoriJustify = 3

        total_row = len(recipients) + 2
        sheet.getCellRangeByName(f"A{total_row}").String = "TOTAL"
        sheet.getCellRangeByName(f"B{total_row}").Formula = f"=SUM(B2:B{total_row - 1})"
        total_range = sheet.getCellRangeByName(f"A{total_row}:B{total_row}")
        total_range.CellBackColor = 0x17365D
        total_range.CharColor = 0xFFFFFF
        total_range.CharWeight = 150
        total_range.CharHeight = 11
        total_range.CharFontName = "Aptos"
        total_range.Rows.Height = 650
        sheet.getCellRangeByName(f"B{total_row}").NumberFormat = currency_format
        sheet.getCellRangeByName(f"B{total_row}").HoriJustify = 3

        sheet.Columns.getByIndex(0).Width = 6500
        sheet.Columns.getByIndex(1).Width = 3200
        document.CurrentController.setActiveSheet(sheet)
        document.CurrentController.freezeAtPosition(0, 1)
        try:
            document.CurrentController.ShowGrid = False
        except Exception:
            pass

        page_style = document.StyleFamilies.getByName("PageStyles").getByName(sheet.PageStyle)
        page_style.LeftMargin = 1100
        page_style.RightMargin = 1100
        page_style.TopMargin = 900
        page_style.BottomMargin = 900
        page_style.HeaderIsOn = False
        page_style.FooterIsOn = False
        page_style.ScaleToPagesX = 1
        page_style.ScaleToPagesY = 1

        document.calculateAll()
        total = sheet.getCellRangeByName(f"B{total_row}").Value
        if abs(total - settlement["totals"]["totalPay"]) > 0.005:
            raise RuntimeError(f"Total mismatch: {total}")

        document.storeAsURL(
            uno.systemPathToFileUrl(str(OUTPUT_PATH)),
            (prop("FilterName", "Calc MS Excel 2007 XML"), prop("Overwrite", True)),
        )
        normalize_excel_currency_format(OUTPUT_PATH)
        document.storeToURL(
            uno.systemPathToFileUrl(str(PREVIEW_PATH)),
            (prop("FilterName", "calc_pdf_Export"), prop("Overwrite", True)),
        )
        print(
            json.dumps(
                {
                    "xlsx": str(OUTPUT_PATH),
                    "preview": str(PREVIEW_PATH),
                    "sheet": sheet.Name,
                    "recipients": len(recipients),
                    "total": total,
                },
                indent=2,
            )
        )
    finally:
        if document is not None:
            document.close(True)
        if process is not None:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
        shutil.rmtree(profile, ignore_errors=True)


if __name__ == "__main__":
    main()
