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

app = FastAPI(title="SmartHoreca Local Document AI", version="1.0.0")

OCR_LANG = os.getenv("OCR_LANG", "az").strip() or "az"
OCR_VERSION = os.getenv("OCR_VERSION", "PP-OCRv5").strip() or "PP-OCRv5"
LOCAL_AI_TOKEN = os.getenv("LOCAL_AI_TOKEN", "").strip()
OLLAMA_URL = os.getenv("OLLAMA_URL", "").strip().rstrip("/")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "qwen2.5:7b").strip() or "qwen2.5:7b"

_ocr: PaddleOCR | None = None

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


def ordered_lines(lines: list[OcrLine]) -> list[OcrLine]:
    def pos(line: OcrLine):
        if line.box and len(line.box) >= 4:
            return (line.page, line.box[1], line.box[0])
        return (line.page, 0, 0)
    return sorted(lines, key=pos)


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
                supplier = value[1].strip()
                suffixes = (" MMC", " LLC", " ASC", " OOO", " ООО")
                for quote in ('"', "“", "”", "«", "»"):
                    for suffix in suffixes:
                        supplier = supplier.replace(quote + suffix, suffix)
                return supplier.strip(' "“”«»')

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
    if fallback:
        return fallback.strip(' "“”«»')
    return None


def likely_doc_number(lines: list[OcrLine]) -> str | None:
    keywords = (
        "nömr", "nomr", "номер", "number", "document no", "sənədin", "senedin",
        "sndin", "qaimə", "qaime", "invoice", "faktura", "накладн", "№"
    )
    for line in ordered_lines(lines)[:40]:
        low = line.text.lower()
        if not any(w in low for w in keywords):
            continue

        # Most supplier forms print the value after a colon.
        after = re.search(r"[:：#№]\s*([A-ZА-ЯƏÖÜĞÇŞİ0-9][A-ZА-ЯƏÖÜĞÇŞİ0-9./_-]{1,})\s*$", line.text, re.I)
        if after:
            value = after.group(1).strip()
            if not iso_date(value):
                return value

        # OCR may remove the separator: use the last plausible token.
        tokens = re.findall(r"[A-ZА-ЯƏÖÜĞÇŞİ0-9][A-ZА-ЯƏÖÜĞÇŞİ0-9./_-]{1,}", line.text, re.I)
        for value in reversed(tokens):
            if not iso_date(value) and any(ch.isdigit() for ch in value):
                return value
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

        # Product name comes from the nomenclature column, not arbitrary
        # alphabetic text on the page.
        product_cells: list[OcrLine] = []
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

        # Once a product-name header is known, accept only text that really
        # sits in that table column. This blocks comments such as
        # "Примечание: 22 cafe" from becoming fake purchase rows.
        if name_x is not None and product_cells:
            product_center = sum((_cx(x) or 0) for x in product_cells) / len(product_cells)
            column_tolerance = 180
            if abs(product_center - name_x) > column_tolerance:
                continue

        # A normal purchase row should have table evidence to the left of
        # the product name (row number and/or supplier article/code).
        if name_x is not None:
            left_numeric = [
                x for x in cells
                if (_cx(x) is not None and (_cx(x) or 0) < name_x - 20)
                and len(line_numbers(x.text)) == 1
            ]
            if not left_numeric and code_x is not None:
                continue

        # Quantity must come from the Miqdar/Quantity column. This avoids
        # confusing row numbers 1,2,3... with quantities.
        qty_pick = _nearest_numeric(cells, qty_x)
        quantity = qty_pick[1] if qty_pick else None

        # Unit is the text closest to the unit column.
        unit = None
        if unit_x is not None:
            unit_cells = [
                x for x in cells
                if _cx(x) is not None
                and abs((_cx(x) or 0) - unit_x) <= 55
                and any(ch.isalpha() for ch in x.text)
            ]
            if unit_cells:
                unit = min(unit_cells, key=lambda x: abs((_cx(x) or 0) - unit_x)).text.strip() or None

        # Supplier article/code is valuable for future exact matching.
        article = None
        if code_x is not None:
            code_cells = [
                x for x in cells
                if _cx(x) is not None
                and abs((_cx(x) or 0) - code_x) <= 60
                and re.fullmatch(r"[A-Za-zА-Яа-я0-9._/-]{2,}", x.text.strip())
            ]
            if code_cells:
                article = min(code_cells, key=lambda x: abs((_cx(x) or 0) - code_x)).text.strip()

        # Price and line total are numeric cells to the right of quantity.
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

        # Require table-like evidence. A date/header line must not become a
        # purchase item merely because it contains several numbers.
        if quantity is None or price is None:
            continue
        if total is None:
            total = round(quantity * price, 4)

        confidence_cells = list({id(x): x for x in (product_cells + [p[1] for p in right_of_qty] + ([qty_pick[0]] if qty_pick else []))}.values())
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


def heuristic_parse(lines: list[OcrLine]) -> dict[str, Any]:
    ordered = ordered_lines(lines)
    all_text = "\n".join(x.text for x in ordered)
    dates = [iso_date(x.text) for x in ordered]
    dates = [x for x in dates if x]
    scores = [x.score for x in ordered if x.text]
    items = row_candidates(ordered)
    confidence = sum(scores) / len(scores) if scores else 0.0
    supplier_document_number = likely_doc_number(ordered)
    return {
        "documentType": "incoming_invoice",
        "supplierName": likely_supplier(ordered),
        # SmartHoreca/iiko document number is generated by our system.
        # The number printed by the supplier belongs in incomingNumber.
        "documentNumber": None,
        "invoiceNumber": None,
        "incomingNumber": supplier_document_number,
        "date": dates[0] if dates else None,
        "dueDate": dates[1] if len(dates) > 1 else None,
        "currency": "AZN" if re.search(r"\b(AZN|₼|MANAT|MAN)\b", all_text, re.I) else None,
        "total": likely_total(ordered, items),
        "vatTotal": None,
        "confidence": round(confidence, 4),
        "items": items,
        "ocrText": all_text,
        "ocrLines": [
            {"page": x.page, "text": x.text, "confidence": round(x.score, 4), "box": x.box}
            for x in ordered
        ],
        "localParser": "heuristic-v3",
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

        lines = ocr_document(temp_path)
        heuristic = heuristic_parse(lines)

        parsed = None
        parser = heuristic.get("localParser", "heuristic-v3")
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
