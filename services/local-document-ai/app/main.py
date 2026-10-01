from __future__ import annotations

import json
import os
import re
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import requests
from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile
from paddleocr import PaddleOCR
from PIL import Image, ImageEnhance, ImageFilter, ImageOps

app = FastAPI(title="SmartHoreca Local Document AI", version="1.0.0")

OCR_LANG = os.getenv("OCR_LANG", "az").strip() or "az"
OCR_VERSION = os.getenv("OCR_VERSION", "PP-OCRv5").strip() or "PP-OCRv5"
LOCAL_AI_TOKEN = os.getenv("LOCAL_AI_TOKEN", "").strip()
OLLAMA_URL = os.getenv("OLLAMA_URL", "").strip().rstrip("/")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "qwen2.5:7b").strip() or "qwen2.5:7b"
SECONDARY_OCR = os.getenv("SECONDARY_OCR", "easyocr").strip().lower()
SECONDARY_OCR_LANGS = [
    x.strip() for x in os.getenv("SECONDARY_OCR_LANGS", "az,en").split(",") if x.strip()
] or ["az", "en"]

_ocr: PaddleOCR | None = None
_easyocr_reader: Any | None = None

DATE_PATTERNS = [
    re.compile(r"\b(20\d{2})[-./](0?[1-9]|1[0-2])[-./]([0-2]?\d|3[01])\b"),
    re.compile(r"\b([0-2]?\d|3[01])[-./](0?[1-9]|1[0-2])[-./](20\d{2})\b"),
]
MONEY_RE = re.compile(r"(?<!\w)(\d{1,7}(?:[ .]\d{3})*(?:[,.]\d{1,4})?)(?!\w)")
QTY_RE = re.compile(r"(?<!\w)(\d+(?:[,.]\d{1,3})?)\s*(əd|ed|шт|pcs?|kg|кг|qram|gr|qr|g|l|lt|л|ml|мл)?\b", re.I)
TOTAL_WORDS = ("cəmi", "cemi", "cmi", "yekun", "toplam", "total", "итого", "всего", "məbləğ")
DATE_WORDS = ("tarix", "date", "дата")
DOCNO_WORDS = ("qaimə", "qaimə №", "invoice", "накладн", "faktura", "faktura №", "№")
HEADER_WORDS = (
    "malın adı", "məhsul", "miqdar", "qiymət", "məbləğ", "товар", "наименование",
    "количество", "цена", "сумма", "quantity", "price", "amount"
)
SUPPLIER_LABELS = (
    "təchizatçı", "techizatci", "techizatçı", "tchizatçı", "tchizatci",
    "поставщик", "supplier"
)
FREEFORM_UNITS = (
    "kg", "кг", "qram", "qr", "gr", "g", "əd", "ed", "шт", "pcs", "pc",
    "l", "lt", "л", "ml", "мл"
)
CURRENCY_HINTS = ("azn", "₼", "manat", "манат")


@dataclass
class OcrLine:
    page: int
    text: str
    score: float
    box: list[float] | None = None


def get_ocr() -> PaddleOCR:
    global _ocr
    if _ocr is None:
        _ocr = PaddleOCR(
            lang=OCR_LANG,
            ocr_version=OCR_VERSION,
            use_doc_orientation_classify=False,
            use_doc_unwarping=False,
            use_textline_orientation=False,
        )
    return _ocr


def get_easyocr_reader():
    global _easyocr_reader
    if SECONDARY_OCR != "easyocr":
        return None
    if _easyocr_reader is None:
        import easyocr
        _easyocr_reader = easyocr.Reader(
            SECONDARY_OCR_LANGS,
            gpu=False,
            verbose=False,
        )
    return _easyocr_reader


def num(value: str | None) -> float | None:
    if not value:
        return None
    s = value.strip().replace(" ", "")
    if "," in s and "." in s:
        if s.rfind(",") > s.rfind("."):
            s = s.replace(".", "").replace(",", ".")
        else:
            s = s.replace(",", "")
    else:
        s = s.replace(",", ".")
    try:
        return float(s)
    except ValueError:
        return None


def iso_date(text: str) -> str | None:
    for index, p in enumerate(DATE_PATTERNS):
        m = p.search(text)
        if not m:
            continue
        a, b, c = m.groups()
        if index == 0:
            y, mo, d = int(a), int(b), int(c)
        else:
            d, mo, y = int(a), int(b), int(c)
        if 1 <= mo <= 12 and 1 <= d <= 31:
            return f"{y:04d}-{mo:02d}-{d:02d}"
    return None


def normalize_result_json(result: Any) -> dict[str, Any]:
    data = getattr(result, "json", None)
    if callable(data):
        data = data()
    if isinstance(data, str):
        data = json.loads(data)
    if not isinstance(data, dict):
        return {}
    return data.get("res", data)


def ocr_document(path: str) -> list[OcrLine]:
    pipeline = get_ocr()
    output: list[OcrLine] = []
    results = pipeline.predict(path)
    for page_index, result in enumerate(results):
        data = normalize_result_json(result)
        texts = list(data.get("rec_texts") or [])
        scores = list(data.get("rec_scores") or [])
        boxes = list(data.get("rec_boxes") or [])
        page = data.get("page_index")
        page_no = int(page) if page is not None else page_index
        for i, text in enumerate(texts):
            clean_text = str(text or "").strip()
            if not clean_text:
                continue
            score = float(scores[i]) if i < len(scores) else 0.0
            raw_box = boxes[i] if i < len(boxes) else None
            box = None
            if raw_box is not None:
                try:
                    box = [float(x) for x in raw_box]
                except Exception:
                    box = None
            output.append(OcrLine(page=page_no, text=clean_text, score=score, box=box))
    return output


def easyocr_document(path: str) -> list[OcrLine]:
    reader = get_easyocr_reader()
    if reader is None:
        return []

    raw = reader.readtext(path, detail=1, paragraph=False)
    output: list[OcrLine] = []
    for item in raw:
        try:
            box_points, text, score = item
            clean_text = str(text or "").strip()
            if not clean_text:
                continue
            xs = [float(point[0]) for point in box_points]
            ys = [float(point[1]) for point in box_points]
            box = [min(xs), min(ys), max(xs), max(ys)]
            output.append(
                OcrLine(
                    page=0,
                    text=clean_text,
                    score=float(score or 0.0),
                    box=box,
                )
            )
        except Exception:
            continue
    return output


def should_try_secondary_ocr(parsed: dict[str, Any]) -> bool:
    if SECONDARY_OCR != "easyocr":
        return False
    items = parsed.get("items") or []
    confidence = float(parsed.get("confidence") or 0.0)
    mode = parsed.get("documentMode")
    supplier = parsed.get("supplierName")
    return (
        len(items) == 0
        or confidence < 0.82
        or (mode == "freeform" and len(items) < 2)
        or (mode == "freeform" and not supplier)
    )


def ordered_lines(lines: list[OcrLine]) -> list[OcrLine]:
    def pos(line: OcrLine):
        if line.box and len(line.box) >= 4:
            return (line.page, line.box[1], line.box[0])
        return (line.page, 0, 0)
    return sorted(lines, key=pos)


def _image_variants(path: str) -> list[tuple[str, str]]:
    suffix = Path(path).suffix.lower()
    if suffix not in {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tif", ".tiff"}:
        return [("original", path)]

    variants: list[tuple[str, str]] = [("original", path)]
    try:
        with Image.open(path) as source:
            base = ImageOps.exif_transpose(source).convert("RGB")
            scale = 2 if max(base.size) < 3200 else 1

            gray = ImageOps.grayscale(base)
            gray = ImageOps.autocontrast(gray, cutoff=1)
            if scale > 1:
                gray = gray.resize((gray.width * scale, gray.height * scale), Image.Resampling.LANCZOS)
            gray = ImageEnhance.Contrast(gray).enhance(1.55)
            gray = gray.filter(ImageFilter.SHARPEN)
            tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".png")
            tmp.close()
            gray.save(tmp.name, "PNG")
            variants.append(("gray-contrast", tmp.name))

            strong = ImageOps.grayscale(base)
            strong = ImageOps.autocontrast(strong, cutoff=0)
            if scale > 1:
                strong = strong.resize((strong.width * scale, strong.height * scale), Image.Resampling.LANCZOS)
            strong = ImageEnhance.Contrast(strong).enhance(2.05)
            strong = ImageEnhance.Sharpness(strong).enhance(1.8)
            tmp2 = tempfile.NamedTemporaryFile(delete=False, suffix=".png")
            tmp2.close()
            strong.save(tmp2.name, "PNG")
            variants.append(("gray-strong", tmp2.name))
    except Exception:
        return [("original", path)]
    return variants


def ocr_document_candidates(path: str) -> list[tuple[str, list[OcrLine]]]:
    variants = _image_variants(path)
    results: list[tuple[str, list[OcrLine]]] = []
    try:
        for label, candidate_path in variants:
            try:
                results.append((label, ocr_document(candidate_path)))
            except Exception:
                if label == "original":
                    raise
    finally:
        for label, candidate_path in variants:
            if label == "original" or candidate_path == path:
                continue
            try:
                os.unlink(candidate_path)
            except OSError:
                pass
    return results or [("original", ocr_document(path))]


def _clean_supplier_name(value: str | None) -> str | None:
    supplier = (value or "").strip()
    if not supplier:
        return None
    suffixes = (" MMC", " LLC", " ASC", " OOO", " ООО")
    for quote in ('"', "“", "”", "«", "»"):
        for suffix in suffixes:
            supplier = supplier.replace(quote + suffix, suffix)
    return supplier.strip(' "“”«»') or None


def likely_supplier(lines: list[OcrLine]) -> str | None:
    top = ordered_lines(lines)[:24]

    # Prefer an explicit supplier label. Azerbaijani OCR commonly loses
    # diacritics, so accept both correct and OCR-degraded variants.
    supplier_labels = ("təchizatçı", "techizatci", "tchizatçı", "tchizatci", "поставщик", "supplier")
    for line in top:
        low = line.text.lower()
        if any(label in low for label in supplier_labels):
            value = re.split(r"[:：]", line.text, maxsplit=1)
            if len(value) == 2 and value[1].strip():
                return _clean_supplier_name(value[1])

    bad = tuple(x.lower() for x in HEADER_WORDS + TOTAL_WORDS + DATE_WORDS)
    candidates: list[tuple[float, str]] = []
    for line in top:
        text = line.text.strip()
        low = text.lower()
        if len(text) < 3 or any(w in low for w in bad):
            continue
        if iso_date(text) or MONEY_RE.fullmatch(text):
            continue
        alpha = sum(ch.isalpha() for ch in text)
        if alpha < 3:
            continue
        bonus = 0.12 if any(x in low for x in ("mmc", "llc", "asc", "şirk", "company", "market")) else 0
        candidates.append((line.score + bonus + min(len(text), 45) / 300, text))
    fallback = max(candidates, default=(0, None))[1]
    return _clean_supplier_name(fallback)


def likely_doc_number(lines: list[OcrLine]) -> str | None:
    ordered = ordered_lines(lines)
    keywords = (
        "nömr", "nomr", "номер", "number", "document no", "sənədin", "senedin",
        "sndin", "qaimə", "qaime", "invoice", "faktura", "накладн", "№"
    )
    for line in ordered[:40]:
        low = line.text.lower()
        if not any(w in low for w in keywords):
            continue

        after = re.search(r"[:：#№]\s*([A-ZА-ЯƏÖÜĞÇŞİ0-9][A-ZА-ЯƏÖÜĞÇŞİ0-9./_-]{1,})\s*$", line.text, re.I)
        if after:
            value = after.group(1).strip()
            if not iso_date(value):
                return value

        tokens = re.findall(r"[A-ZА-ЯƏÖÜĞÇŞİ0-9][A-ZА-ЯƏÖÜĞÇŞİ0-9./_-]{1,}", line.text, re.I)
        for value in reversed(tokens):
            if not iso_date(value) and any(ch.isdigit() for ch in value):
                return value

    # Weak OCR can drop the label but preserve ": 1025". In the document
    # header, use the first colon-prefixed integer before the date/table.
    for line in ordered[:20]:
        if iso_date(line.text):
            continue
        m = re.fullmatch(r"\s*[:：#№]?\s*(\d{2,10})\s*", line.text)
        if m:
            return m.group(1)
    return None


def line_numbers(text: str) -> list[float]:
    out = []
    for m in MONEY_RE.finditer(text):
        value = num(m.group(1))
        if value is not None:
            out.append(value)
    return out


def _cx(line: OcrLine) -> float | None:
    if not line.box or len(line.box) < 4:
        return None
    return (line.box[0] + line.box[2]) / 2


def _cy(line: OcrLine) -> float | None:
    if not line.box or len(line.box) < 4:
        return None
    return (line.box[1] + line.box[3]) / 2


def _is_total_label(text: str) -> bool:
    low = text.lower().strip()
    compact = re.sub(r"[^a-zA-Zа-яА-Яəöüğçşıİ]+", "", low)
    return any(word in low for word in TOTAL_WORDS) or compact in {"cmi", "cemi", "cəmi", "yekun", "total", "итого"}


def likely_total(lines: list[OcrLine], items: list[dict[str, Any]] | None = None) -> float | None:
    ordered = ordered_lines(lines)

    # Total label and amount are often separate OCR boxes on the same row.
    for label in reversed(ordered):
        if not _is_total_label(label.text):
            continue
        ly = _cy(label)
        lx = _cx(label)
        same_row: list[tuple[float, float]] = []
        for candidate in ordered:
            if candidate.page != label.page:
                continue
            cy = _cy(candidate)
            cx = _cx(candidate)
            if ly is None or cy is None or abs(cy - ly) > 24:
                continue
            if lx is not None and cx is not None and cx <= lx:
                continue
            for value in line_numbers(candidate.text):
                same_row.append((cx or 0, value))
        if same_row:
            same_row.sort(key=lambda x: x[0])
            return same_row[-1][1]

        values = line_numbers(label.text)
        if values:
            return values[-1]

    # Safer fallback than "largest number near the bottom": supplier article
    # codes such as 0124 must never become the invoice total.
    row_totals = [float(x["total"]) for x in (items or []) if x.get("total") is not None]
    if row_totals:
        return round(sum(row_totals), 4)
    return None


def _header_match(text: str, aliases: tuple[str, ...]) -> bool:
    low = text.lower().strip()
    return any(alias in low for alias in aliases)


def _nearest_numeric(cells: list[OcrLine], target_x: float | None, min_x: float | None = None) -> tuple[OcrLine, float] | None:
    candidates: list[tuple[float, OcrLine, float]] = []
    for cell in cells:
        cx = _cx(cell)
        if cx is None:
            continue
        if min_x is not None and cx < min_x:
            continue
        values = line_numbers(cell.text)
        if len(values) != 1:
            continue
        distance = abs(cx - target_x) if target_x is not None else cx
        candidates.append((distance, cell, values[0]))
    if not candidates:
        return None
    _, cell, value = min(candidates, key=lambda x: x[0])
    return cell, value


def row_candidates(lines: list[OcrLine]) -> list[dict[str, Any]]:
    ordered = ordered_lines(lines)

    name_header = next((x for x in ordered if _header_match(x.text, (
        "nomenklatura", "наименование", "продукт", "товар", "product", "məhsul", "malın adı"
    ))), None)
    code_header = next((x for x in ordered if _header_match(x.text, ("kod", "code", "код", "артикул"))), None)
    unit_header = next((x for x in ordered if _header_match(x.text, (
        "ölçü", "vah.", "ед.", "ед. изм", "ед изм", "unit"
    ))), None)
    qty_header = next((x for x in ordered if _header_match(x.text, (
        "miqdar", "колич", "кол-во", "кол во", "колво", "quantity", "qty"
    ))), None)

    price_headers = [x for x in ordered if _header_match(x.text, (
        "qiym", "цена", "стоим", "price", "cost"
    ))]
    price_headers = sorted([x for x in price_headers if _cx(x) is not None], key=lambda x: _cx(x) or 0)

    header_lines = [x for x in (name_header, code_header, unit_header, qty_header, *price_headers) if x and x.box]
    header_bottom = max((x.box[3] for x in header_lines), default=0)

    name_x = _cx(name_header) if name_header else None
    code_x = _cx(code_header) if code_header else None
    unit_x = _cx(unit_header) if unit_header else None
    qty_x = _cx(qty_header) if qty_header else None

    # Group OCR boxes that share approximately the same Y coordinate.
    rows: list[list[OcrLine]] = []
    for line in ordered:
        if line.box and line.box[1] <= header_bottom + 8:
            continue
        if not line.box:
            continue
        y = _cy(line)
        matched = None
        for row in reversed(rows[-10:]):
            boxed = [x for x in row if x.box]
            if not boxed:
                continue
            ry = sum(_cy(x) or 0 for x in boxed) / len(boxed)
            heights = [max(8, x.box[3] - x.box[1]) for x in boxed]
            tolerance = max(10, min(15, sum(heights) / len(heights) * 0.65))
            if row[0].page == line.page and y is not None and abs(ry - y) <= tolerance:
                matched = row
                break
        if matched is None:
            rows.append([line])
        else:
            matched.append(line)

    output = []
    for row in rows:
        cells = sorted(row, key=lambda x: _cx(x) or 0)
        text = " | ".join(x.text for x in cells)
        low = text.lower()

        if _is_total_label(text) or any(h in low for h in HEADER_WORDS):
            continue
        if iso_date(text):
            continue

        numeric_cells: list[tuple[float, OcrLine, float]] = []
        for cell in cells:
            cx = _cx(cell)
            values = line_numbers(cell.text)
            if cx is not None and len(values) == 1:
                numeric_cells.append((cx, cell, values[0]))
        numeric_cells.sort(key=lambda x: x[0])

        # Geometry fallback for badly OCR'ed headers.
        # A real purchase row usually contains row no/code on the left and
        # quantity/price/line total as three separate numeric cells on the right.
        geometry_mode = qty_x is None or name_x is None
        geometry_qty = geometry_price = geometry_total = None
        geometry_article = None
        geometry_product_cells: list[OcrLine] = []
        geometry_unit = None

        if geometry_mode:
            if len(numeric_cells) < 4:
                # This is what blocks notes like ": 22 cafe" from becoming items.
                continue

            right_three = numeric_cells[-3:]
            geometry_qty = right_three[0][2]
            geometry_price = right_three[1][2]
            geometry_total = right_three[2][2]
            qty_cell_x = right_three[0][0]

            # Supplier code/article normally sits immediately after row number.
            if len(numeric_cells) >= 5:
                geometry_article = numeric_cells[1][1].text.strip()

            # Product text is left of quantity. Keep text well away from the
            # unit column so "kr/kg/ed" does not become part of the product name.
            alpha_cells = [
                x for x in cells
                if _cx(x) is not None
                and any(ch.isalpha() for ch in x.text)
                and (_cx(x) or 0) < qty_cell_x - 150
            ]
            if alpha_cells:
                # Ignore tiny OCR fragments; keep product words in natural X order.
                geometry_product_cells = [
                    x for x in alpha_cells
                    if sum(ch.isalpha() for ch in x.text) >= 2
                ]

            # Unit is usually the alphabetic cell immediately to the left of quantity.
            unit_candidates = [
                x for x in cells
                if _cx(x) is not None
                and any(ch.isalpha() for ch in x.text)
                and qty_cell_x - 150 <= (_cx(x) or 0) < qty_cell_x
            ]
            if unit_candidates:
                geometry_unit = min(unit_candidates, key=lambda x: abs(qty_cell_x - (_cx(x) or 0))).text.strip() or None

            if not geometry_product_cells:
                continue

        # Product name comes from the nomenclature column when headers are usable.
        product_cells: list[OcrLine] = []
        if geometry_mode:
            product_cells = geometry_product_cells
        else:
            for cell in cells:
                cx = _cx(cell)
                if cx is None:
                    continue
                left_ok = code_x is None or cx > code_x + 12
                right_boundary = unit_x if unit_x is not None else qty_x
                right_ok = right_boundary is None or cx < right_boundary - 25
                if left_ok and right_ok and sum(ch.isalpha() for ch in cell.text) >= 2:
                    product_cells.append(cell)

            if not product_cells and name_x is not None:
                alpha_cells = [x for x in cells if sum(ch.isalpha() for ch in x.text) >= 2 and _cx(x) is not None]
                if alpha_cells:
                    product_cells = [min(alpha_cells, key=lambda x: abs((_cx(x) or 0) - name_x))]

        name = " ".join(x.text.strip() for x in product_cells).strip()
        if len(name) < 2:
            continue

        if not geometry_mode and name_x is not None and product_cells:
            product_center = sum((_cx(x) or 0) for x in product_cells) / len(product_cells)
            if abs(product_center - name_x) > 180:
                continue

        # Quantity / price / total.
        if geometry_mode:
            quantity = geometry_qty
            price = geometry_price
            total = geometry_total
            qty_pick = None
        else:
            qty_pick = _nearest_numeric(cells, qty_x)
            quantity = qty_pick[1] if qty_pick else None
            right_of_qty: list[tuple[float, OcrLine, float]] = []
            threshold = (qty_x + 35) if qty_x is not None else 0
            for cell in cells:
                cx = _cx(cell)
                if cx is None or cx < threshold:
                    continue
                values = line_numbers(cell.text)
                if len(values) == 1:
                    right_of_qty.append((cx, cell, values[0]))
            right_of_qty.sort(key=lambda x: x[0])
            price = right_of_qty[0][2] if right_of_qty else None
            total = right_of_qty[-1][2] if len(right_of_qty) >= 2 else None

        if quantity is None or price is None:
            continue
        if total is None:
            total = round(quantity * price, 4)

        # Reject obviously inconsistent fake rows. Allow small rounding differences.
        expected_total = quantity * price
        tolerance = max(0.05, abs(total) * 0.03)
        if abs(expected_total - total) > tolerance:
            continue

        unit = geometry_unit
        if not geometry_mode and unit_x is not None:
            unit_cells = [
                x for x in cells
                if _cx(x) is not None
                and abs((_cx(x) or 0) - unit_x) <= 55
                and any(ch.isalpha() for ch in x.text)
            ]
            if unit_cells:
                unit = min(unit_cells, key=lambda x: abs((_cx(x) or 0) - unit_x)).text.strip() or None

        article = geometry_article
        if not geometry_mode and code_x is not None:
            code_cells = [
                x for x in cells
                if _cx(x) is not None
                and abs((_cx(x) or 0) - code_x) <= 60
                and re.fullmatch(r"[A-Za-zА-Яа-я0-9._/-]{2,}", x.text.strip())
            ]
            if code_cells:
                article = min(code_cells, key=lambda x: abs((_cx(x) or 0) - code_x)).text.strip()

        confidence_cells = product_cells[:]
        confidence_cells.extend([x[1] for x in numeric_cells[-3:]])
        confidence = sum(x.score for x in confidence_cells) / max(1, len(confidence_cells))
        output.append({
            "sourceName": name[:240],
            "article": article,
            "quantity": quantity,
            "unit": unit,
            "unitPrice": price,
            "total": total,
            "vatPercent": None,
            "confidence": round(confidence, 4),
        })
    return output




def _visual_rows(lines: list[OcrLine]) -> list[list[OcrLine]]:
    rows: list[list[OcrLine]] = []
    for line in ordered_lines([x for x in lines if x.box]):
        cy = _cy(line)
        if cy is None:
            continue
        matched = None
        for row in reversed(rows[-12:]):
            if not row or row[0].page != line.page:
                continue
            centers = [_cy(x) for x in row if _cy(x) is not None]
            heights = [max(10.0, x.box[3] - x.box[1]) for x in row if x.box]
            if not centers:
                continue
            row_y = sum(centers) / len(centers)
            avg_h = sum(heights) / len(heights) if heights else 24.0
            tolerance = max(16.0, min(44.0, avg_h * 0.8))
            if abs(row_y - cy) <= tolerance:
                matched = row
                break
        if matched is None:
            rows.append([line])
        else:
            matched.append(line)
    for row in rows:
        row.sort(key=lambda x: _cx(x) or 0)
    return rows


def _row_text(row: list[OcrLine]) -> str:
    return " ".join(x.text.strip() for x in row if x.text.strip())


def _clean_freeform_name(value: str) -> str:
    value = re.sub(r"^[\s\-–—:;,.>→=]+|[\s\-–—:;,.>→=]+$", "", value or "")
    return re.sub(r"\s+", " ", value).strip()[:240]


def _freeform_supplier(lines: list[OcrLine]) -> str | None:
    pattern = re.compile(
        r"(?:təchizatçı|techizatci|techizatçı|tchizatçı|tchizatci|поставщик|supplier)"
        r"\s*(?:[:=\-–—>→]+)?\s*(.+)$",
        re.I,
    )
    for row in _visual_rows(lines)[:16]:
        text = _row_text(row)
        low = text.lower()
        if not any(label in low for label in SUPPLIER_LABELS):
            continue
        match = pattern.search(text)
        if match:
            candidate = _clean_supplier_name(_clean_freeform_name(match.group(1)))
            if candidate and sum(ch.isalpha() for ch in candidate) >= 2:
                return candidate
        label_cells = [x for x in row if any(label in x.text.lower() for label in SUPPLIER_LABELS)]
        if label_cells:
            right_edge = max((x.box[2] for x in label_cells if x.box), default=0)
            right_text = " ".join(
                x.text.strip() for x in row
                if x.box and x.box[0] > right_edge and x.text.strip()
            )
            candidate = _clean_supplier_name(_clean_freeform_name(right_text))
            if candidate and sum(ch.isalpha() for ch in candidate) >= 2:
                return candidate
    return None



def _adjacent_hint(text: str, match: re.Match[str], tokens: tuple[str, ...]) -> str | None:
    """Return a unit/currency token only when it directly belongs to this number.

    Examples:
      "3 AZN - 10" -> AZN belongs to 3, not 10
      "4 kg - 5.2" -> kg belongs to 4, not 5.2
    """
    after = text[match.end():match.end() + 18]
    before = text[max(0, match.start() - 18):match.start()]

    for token in sorted(tokens, key=len, reverse=True):
        escaped = re.escape(token)
        if re.search(r"^\s*" + escaped + r"(?!\w)", after, re.I):
            return token
        if re.search(r"(?<!\w)" + escaped + r"\s*$", before, re.I):
            return token
    return None


def _unit_near(text: str, match: re.Match[str]) -> str | None:
    return _adjacent_hint(text, match, FREEFORM_UNITS)


def _currency_near(text: str, match: re.Match[str]) -> bool:
    return _adjacent_hint(text, match, CURRENCY_HINTS) is not None


def _best_freeform_numeric_triplet(text: str) -> tuple[float, float, float, str | None, int] | None:
    matches = list(MONEY_RE.finditer(text))
    if len(matches) < 3:
        return None

    candidates = []
    for i in range(len(matches) - 2):
        for j in range(i + 1, len(matches) - 1):
            for k in range(j + 1, len(matches)):
                a = num(matches[i].group(1))
                b = num(matches[j].group(1))
                total = num(matches[k].group(1))
                if a is None or b is None or total is None:
                    continue
                tolerance = max(0.06, abs(total) * 0.025)
                if abs((a * b) - total) > tolerance:
                    continue

                unit_a = _unit_near(text, matches[i])
                unit_b = _unit_near(text, matches[j])
                currency_a = _currency_near(text, matches[i])
                currency_b = _currency_near(text, matches[j])

                quantity = a
                price = b
                unit = unit_a
                if currency_a and not currency_b:
                    price = a
                    quantity = b
                    unit = unit_b
                elif unit_b and not unit_a:
                    price = a
                    quantity = b
                    unit = unit_b

                score = (
                    5.0
                    + (2.0 if unit_a or unit_b else 0.0)
                    + (1.5 if currency_a or currency_b else 0.0)
                    + (0.5 if k == len(matches) - 1 else 0.0)
                    - ((j - i - 1) + (k - j - 1)) * 0.15
                )
                candidates.append((quantity, price, total, unit, i, score))

    if not candidates:
        return None
    quantity, price, total, unit, first_index, _ = max(candidates, key=lambda x: x[-1])
    return quantity, price, total, unit, first_index


def freeform_row_candidates(lines: list[OcrLine]) -> list[dict[str, Any]]:
    output = []
    seen = set()
    for row in _visual_rows(lines):
        text = _row_text(row)
        low = text.lower()
        if not text or any(label in low for label in SUPPLIER_LABELS):
            continue
        if _is_total_label(text) or iso_date(text):
            continue

        triplet = _best_freeform_numeric_triplet(text)
        if not triplet:
            continue
        quantity, price, total, unit, first_number_index = triplet
        number_matches = list(MONEY_RE.finditer(text))
        if first_number_index >= len(number_matches):
            continue

        prefix = text[:number_matches[first_number_index].start()]
        name = _clean_freeform_name(prefix)
        name = re.sub(
            r"\b(?:məhsul|mal|товар|product|item)\b\s*[:=\-–—>→]*\s*",
            "",
            name,
            flags=re.I,
        ).strip()
        if len(name) < 2 or sum(ch.isalpha() for ch in name) < 2:
            continue
        if any(word in name.lower() for word in HEADER_WORDS):
            continue

        row_scores = [x.score for x in row if x.text]
        confidence = sum(row_scores) / len(row_scores) if row_scores else 0.0
        confidence = min(0.98, max(0.45, confidence * 0.92))

        dedupe_key = (
            re.sub(r"\W+", "", name.lower()),
            round(quantity, 4),
            round(price, 4),
            round(total, 4),
        )
        if dedupe_key in seen:
            continue
        seen.add(dedupe_key)

        output.append({
            "sourceName": name,
            "article": None,
            "quantity": quantity,
            "unit": unit,
            "unitPrice": price,
            "total": total,
            "vatPercent": None,
            "confidence": round(confidence, 4),
        })
    return output


def _parser_quality(parsed: dict[str, Any]) -> float:
    items = parsed.get("items") or []
    return (
        len(items) * 100.0
        + (18.0 if parsed.get("supplierName") else 0.0)
        + (8.0 if parsed.get("date") else 0.0)
        + (5.0 if parsed.get("total") is not None else 0.0)
        + float(parsed.get("confidence") or 0.0) * 10.0
    )


def heuristic_parse(lines: list[OcrLine]) -> dict[str, Any]:
    ordered = ordered_lines(lines)
    all_text = "\n".join(x.text for x in ordered)
    dates = [iso_date(x.text) for x in ordered]
    dates = [x for x in dates if x]
    scores = [x.score for x in ordered if x.text]

    table_items = row_candidates(ordered)
    freeform_items = freeform_row_candidates(ordered)
    table_header_hits = sum(
        1 for line in ordered
        if any(word in line.text.lower() for word in HEADER_WORDS)
    )

    use_freeform = bool(freeform_items) and (
        not table_items
        or len(freeform_items) > len(table_items)
        or table_header_hits < 2
    )
    items = freeform_items if use_freeform else table_items
    mode = "freeform" if use_freeform else "table"

    confidence = sum(scores) / len(scores) if scores else 0.0
    supplier_document_number = likely_doc_number(ordered)
    supplier = _freeform_supplier(ordered) if use_freeform else None
    if not supplier:
        supplier = likely_supplier(ordered)

    return {
        "documentType": "incoming_invoice",
        "documentMode": mode,
        "supplierName": supplier,
        "documentNumber": None,
        "invoiceNumber": None,
        "incomingNumber": supplier_document_number,
        "date": dates[0] if dates else None,
        "dueDate": dates[1] if len(dates) > 1 else None,
        "currency": "AZN" if re.search(r"\b(AZN|MANAT|MAN)\b|₼", all_text, re.I) else None,
        "total": likely_total(ordered, items),
        "vatTotal": None,
        "confidence": round(confidence, 4),
        "items": items,
        "ocrText": all_text,
        "ocrLines": [
            {"page": x.page, "text": x.text, "confidence": round(x.score, 4), "box": x.box}
            for x in ordered
        ],
        "localParser": "heuristic-v5",
    }


def ollama_parse(heuristic: dict[str, Any], schema_text: str, prompt: str) -> dict[str, Any] | None:
    if not OLLAMA_URL:
        return None
    schema = {}
    try:
        schema = json.loads(schema_text or "{}")
    except Exception:
        schema = {}
    user_prompt = f"""You are a restaurant purchase-document parser.
Use ONLY the OCR text below. Never invent missing data.
Return JSON matching the supplied schema.

Additional instruction:
{prompt}

OCR text:
{heuristic.get('ocrText','')}

Heuristic draft:
{json.dumps({k:v for k,v in heuristic.items() if k not in ('ocrText','ocrLines')}, ensure_ascii=False)}

JSON schema:
{json.dumps(schema, ensure_ascii=False)}
"""
    response = requests.post(
        f"{OLLAMA_URL}/api/chat",
        json={
            "model": OLLAMA_MODEL,
            "stream": False,
            "format": "json",
            "messages": [{"role": "user", "content": user_prompt}],
            "options": {"temperature": 0},
        },
        timeout=180,
    )
    response.raise_for_status()
    payload = response.json()
    content = payload.get("message", {}).get("content", "")
    parsed = json.loads(content)
    if isinstance(parsed, dict):
        parsed["ocrText"] = heuristic.get("ocrText", "")
        parsed["ocrLines"] = heuristic.get("ocrLines", [])
        parsed["documentMode"] = parsed.get("documentMode") or heuristic.get("documentMode")
        parsed["ocrPass"] = heuristic.get("ocrPass")
        parsed["localParser"] = f"ollama:{OLLAMA_MODEL}"
        return parsed
    return None


def check_auth(authorization: str | None):
    if not LOCAL_AI_TOKEN:
        return
    expected = f"Bearer {LOCAL_AI_TOKEN}"
    if authorization != expected:
        raise HTTPException(status_code=401, detail="Unauthorized")


@app.get("/health")
def health():
    return {
        "ok": True,
        "service": "SmartHoreca Local Document AI",
        "ocrLang": OCR_LANG,
        "ocrVersion": OCR_VERSION,
        "ollamaConfigured": bool(OLLAMA_URL),
        "ollamaModel": OLLAMA_MODEL if OLLAMA_URL else None,
        "parserVersion": "heuristic-v5",
        "imagePreprocessing": True,
    }


@app.post("/process")
async def process(
    file: UploadFile = File(...),
    prompt: str = Form(""),
    schema: str = Form("{}"),
    authorization: str | None = Header(default=None),
):
    check_auth(authorization)
    name = file.filename or "document"
    suffix = Path(name).suffix.lower() or (".pdf" if file.content_type == "application/pdf" else ".png")
    if suffix not in {".pdf", ".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tif", ".tiff"}:
        raise HTTPException(status_code=400, detail="Unsupported file type")

    raw = await file.read()
    if len(raw) > 20 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File is larger than 20 MB")

    temp_path = ""
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as temp:
            temp.write(raw)
            temp_path = temp.name

        ocr_candidates = ocr_document_candidates(temp_path)
        evaluated = []
        for pass_name, candidate_lines in ocr_candidates:
            candidate = heuristic_parse(candidate_lines)
            candidate["ocrPass"] = pass_name
            evaluated.append((candidate, candidate_lines))

        heuristic, lines = max(evaluated, key=lambda pair: _parser_quality(pair[0]))

        parsed = None
        parser = heuristic.get("localParser", "heuristic-v5")
        if OLLAMA_URL:
            try:
                parsed = ollama_parse(heuristic, schema, prompt)
                if parsed:
                    parser = parsed.get("localParser", f"ollama:{OLLAMA_MODEL}")
            except Exception as exc:
                heuristic["ollamaError"] = str(exc)[:500]

        data = parsed or heuristic
        return {
            "id": None,
            "model": f"paddleocr:{OCR_VERSION}/{OCR_LANG}+{parser}",
            "data": data,
            "usage": {
                "ocrLines": len(lines),
                "ocrPasses": len(ocr_candidates),
                "selectedOcrPass": heuristic.get("ocrPass"),
                "documentMode": data.get("documentMode") or heuristic.get("documentMode"),
                "averageConfidence": data.get("confidence"),
                "local": True,
                "paidTokens": 0,
            },
        }
    finally:
        if temp_path:
            try:
                os.unlink(temp_path)
            except OSError:
                pass
