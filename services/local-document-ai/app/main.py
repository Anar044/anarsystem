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
TOTAL_WORDS = ("cəmi", "yekun", "toplam", "total", "итого", "всего", "məbləğ")
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
    top = ordered_lines(lines)[:18]
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
    return max(candidates, default=(0, None))[1]


def likely_doc_number(lines: list[OcrLine]) -> str | None:
    for line in ordered_lines(lines)[:35]:
        low = line.text.lower()
        if any(w in low for w in DOCNO_WORDS):
            m = re.search(r"(?:№|no|n[oº]?|qaimə|invoice|faktura|накладн[^\s:]*)?\s*[:#№-]?\s*([A-ZА-ЯƏÖÜĞÇŞİ0-9][A-ZА-ЯƏÖÜĞÇŞİ0-9./_-]{2,})", line.text, re.I)
            if m:
                value = m.group(1).strip()
                if not iso_date(value):
                    return value
    return None


def line_numbers(text: str) -> list[float]:
    out = []
    for m in MONEY_RE.finditer(text):
        value = num(m.group(1))
        if value is not None:
            out.append(value)
    return out


def likely_total(lines: list[OcrLine]) -> float | None:
    for line in reversed(ordered_lines(lines)):
        low = line.text.lower()
        if any(word in low for word in TOTAL_WORDS):
            values = line_numbers(line.text)
            if values:
                return values[-1]
    tail_values: list[float] = []
    for line in ordered_lines(lines)[-12:]:
        tail_values.extend(line_numbers(line.text))
    return max(tail_values, default=None)


def row_candidates(lines: list[OcrLine]) -> list[dict[str, Any]]:
    # Group OCR boxes that share approximately the same Y coordinate.
    rows: list[list[OcrLine]] = []
    for line in ordered_lines(lines):
        if not line.box:
            rows.append([line])
            continue
        y = (line.box[1] + line.box[3]) / 2
        matched = None
        for row in reversed(rows[-8:]):
            boxed = [x for x in row if x.box]
            if not boxed:
                continue
            ry = sum((x.box[1] + x.box[3]) / 2 for x in boxed) / len(boxed)
            heights = [max(8, x.box[3] - x.box[1]) for x in boxed]
            tolerance = max(12, sum(heights) / len(heights) * 0.75)
            if row[0].page == line.page and abs(ry - y) <= tolerance:
                matched = row
                break
        if matched is None:
            rows.append([line])
        else:
            matched.append(line)

    output = []
    for row in rows:
        cells = sorted(row, key=lambda x: x.box[0] if x.box else 0)
        text = " | ".join(x.text for x in cells)
        low = text.lower()
        if any(h in low for h in HEADER_WORDS):
            continue
        numbers = line_numbers(text)
        if len(numbers) < 2:
            continue

        # Name: prefer non-numeric cells on the left/middle.
        name_parts = []
        for cell in cells:
            t = cell.text.strip()
            if not t or MONEY_RE.fullmatch(t.replace(" ", "")):
                continue
            if QTY_RE.fullmatch(t):
                continue
            if sum(ch.isalpha() for ch in t) >= 2:
                name_parts.append(t)
        name = " ".join(name_parts).strip()
        if len(name) < 2:
            continue

        quantity = None
        unit = None
        for cell in cells:
            m = QTY_RE.search(cell.text)
            if m:
                q = num(m.group(1))
                if q is not None and q > 0:
                    quantity = q
                    unit = (m.group(2) or "").strip() or None
                    break

        price = None
        total = None
        if len(numbers) >= 2:
            total = numbers[-1]
            price = numbers[-2]
        if quantity is None and price not in (None, 0) and total is not None:
            candidate = total / price
            if 0 < candidate < 100000:
                quantity = round(candidate, 3)

        confidence = sum(x.score for x in cells) / max(1, len(cells))
        output.append({
            "sourceName": name[:240],
            "article": None,
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
    return {
        "documentType": "incoming_invoice",
        "supplierName": likely_supplier(ordered),
        "documentNumber": likely_doc_number(ordered),
        "invoiceNumber": None,
        "incomingNumber": None,
        "date": dates[0] if dates else None,
        "dueDate": dates[1] if len(dates) > 1 else None,
        "currency": "AZN" if re.search(r"\b(AZN|₼|MANAT)\b", all_text, re.I) else None,
        "total": likely_total(ordered),
        "vatTotal": None,
        "confidence": round(confidence, 4),
        "items": items,
        "ocrText": all_text,
        "ocrLines": [
            {"page": x.page, "text": x.text, "confidence": round(x.score, 4), "box": x.box}
            for x in ordered
        ],
        "localParser": "heuristic-v1",
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
        parser = "heuristic-v1"
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
