# SmartHoreca Local Document AI

Local-first OCR service for supplier invoices.

Pipeline:

PDF / photo -> PP-OCRv5 -> heuristic-v5 -> (if weak: EasyOCR CPU fallback) -> optional Ollama -> SmartHoreca matching with iiko -> optional OpenAI fallback.

Parser v5 supports two automatic modes:

- `table` - printed supplier invoices with table columns
- `freeform` - handwritten or loosely formatted notes such as `tomat - 4 kg - 5.2 - 20.8`

For image files the service tries the original plus local grayscale/contrast preprocessing passes and selects the best parsed result.

If the best PP-OCRv5 result is weak (no rows, low confidence, or incomplete free-form recognition), the service runs EasyOCR locally on CPU and keeps whichever parsed result scores higher. Both OCR engines are local and require no paid API.

## Requirements

- Windows 10/11
- Docker Desktop
- Internet only for the first Docker/model download
- Recommended: 8 GB RAM or more

## Start on Windows

From the repository root:

    cd services\local-document-ai
    powershell -ExecutionPolicy Bypass -File .\START_LOCAL_AI.ps1

Expected result:

    LOCAL AI GOTOV
    Health:  http://127.0.0.1:8789/health
    Process: http://127.0.0.1:8789/process

Check health:

    Invoke-RestMethod http://127.0.0.1:8789/health

Test a real invoice locally:

    powershell -ExecutionPolicy Bypass -File .\TEST_LOCAL_AI.ps1 -File "C:\path\invoice.jpg"

## Configuration

START_LOCAL_AI.ps1 copies .env.example to .env automatically on first run.

Default values:

    OCR_LANG=az
    OCR_VERSION=PP-OCRv5
    SECONDARY_OCR=easyocr
    SECONDARY_OCR_LANGS=az,en
    LOCAL_AI_TOKEN=
    OLLAMA_URL=
    OLLAMA_MODEL=qwen2.5:7b

If most invoices are Russian, OCR_LANG=ru can be tested instead.

## Optional local LLM / Ollama

The service works without Ollama.

If Ollama is installed on the Windows host:

    OLLAMA_URL=http://host.docker.internal:11434
    OLLAMA_MODEL=qwen2.5:7b

Then OCR text is structured by the local model before it is returned to SmartHoreca.

## Connecting the Cloudflare Preview

Cloudflare Pages cannot call 127.0.0.1 on your PC directly. For testing, expose port 8789 through a Cloudflare Tunnel.

Quick temporary tunnel:

    cloudflared tunnel --url http://127.0.0.1:8789

It prints a temporary HTTPS address such as:

    https://example-random.trycloudflare.com

In the SmartHoreca Cloudflare Pages Preview variables set:

    LOCAL_DOCUMENT_AI_URL=https://example-random.trycloudflare.com

If LOCAL_AI_TOKEN is configured locally, also add the same value as a Cloudflare secret:

    LOCAL_DOCUMENT_AI_TOKEN=...

After a new Preview deployment, AI Documents should show:

    Local AI: готов

For production, use a named Cloudflare Tunnel with a stable hostname.

## Notes

- First recognition is slower because PaddleOCR downloads its model.
- Temporary OCR files are deleted after each request.
- The source document uploaded to SmartHoreca remains in the configured R2 bucket.
- The local service returns OCR text, positions, confidence, and a best-effort invoice structure.


## Handwritten / free-form notes

Example:

    Təchizatçı -> Bravo
    məhsul A - 3 AZN - 10 - 30
    tomat - 4 kg - 5.2 - 20.8

The free-form parser validates arithmetic before accepting a row. It supports both common layouts:

    product - quantity unit - unit price - total
    product - unit price AZN - quantity - total

The second layout is detected from the currency marker near the first number.

After pulling a parser update, rebuild the local Docker image:

    cd C:\SmartHoreca-local-ai\services\local-document-ai
    git pull
    docker compose down
    docker compose up -d --build

Then check:

    curl http://127.0.0.1:8789/health

Expected health includes:

    "parserVersion": "heuristic-v5"


## Secondary OCR fallback (EasyOCR)

The secondary engine is enabled by default:

    SECONDARY_OCR=easyocr
    SECONDARY_OCR_LANGS=az,en

It is loaded lazily only when the primary PP-OCRv5 result is weak. The first fallback request can take longer because EasyOCR downloads its recognition models into the persistent Docker volume `easyocr-models`.

Health output should include:

    "secondaryOcr": "easyocr"

To disable the second engine:

    SECONDARY_OCR=off
