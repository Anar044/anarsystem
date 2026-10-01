# SmartHoreca Local Document AI

Local-first OCR service for supplier invoices.

Pipeline:

PDF / photo -> PaddleOCR -> local parser -> optional Ollama -> SmartHoreca matching with iiko -> optional OpenAI fallback.

PaddleOCR itself does not require a paid API.

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

    LOCAL_DOCUMENT_AI_URL=https://example-random.trycloudflare.com/process

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
