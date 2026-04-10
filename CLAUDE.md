# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A web-based engineering drawing annotation tool with AI-powered dimension recognition. Users upload CAD drawings or images, AI detects dimensions, and they can annotate them with inspection bubbles. Results export to professional Excel inspection records.

## Commands

```bash
# Run locally (development)
python server.py                    # Starts Flask dev server on :5001

# Run with production server
gunicorn --workers 2 --bind 0.0.0.0:5001 --timeout 120 server:app

# Install dependencies
pip install -r requirements.txt

# Docker build
docker buildx build --platform linux/amd64 -t IMAGE_NAME .

# Deploy to production
./deploy.sh
```

No test runner or linter is configured.

## Architecture

### Backend (`server.py`)
Single Flask file serving 5 REST endpoints:
- `POST /api/analyze` — sends image to AI (Anthropic or OpenAI-compatible) for dimension recognition; returns JSON array of annotation objects
- `POST /api/convert` — converts DXF/DWG/SVG files to PNG using ezdxf + cairosvg + matplotlib
- `POST /api/extract-meta` — AI extracts part metadata (name, drawing number, material, quantity) from image
- `POST /api/export` — generates Excel workbook (`openpyxl`) in inspection record format (林海日常检验记录)
- `GET /api/test` — connectivity check

AI provider is selected via `API_PROVIDER` env var (`anthropic` or `openai`). Configuration can also come from frontend requests.

### Frontend (`app.js`, `index.html`, `styles.css`)
Vanilla JS SPA with no build step. State is held in memory; API config persists in `localStorage`.

Key frontend flows:
1. Upload file → auto-detect format → render (PDF uses pdf.js, CAD converts via `/api/convert`, images direct)
2. Run AI analysis via `/api/analyze` → populates annotation table
3. Edit annotations manually; bubbles render as SVG overlay on canvas
4. Export via `/api/export` → downloads `.xlsx`

Annotation object shape:
```js
{ value, upper_tol, lower_tol, type, color, x_pct, y_pct, remarks }
// type: "diameter" | "radius" | "dimension" | "angle" | "roughness" | "other"
```

### Deployment
Docker → Gunicorn → Nginx (port 80) with Supervisor managing both processes. Production server: `157.10.162.22`.

## Development Rules

### Static asset cache busting
Static files use content-hash suffixes for cache busting: `app-<hash>.js`, `styles-<hash>.css`. The hash is the first 8 characters of the file's MD5.

**When you modify `app-<hash>.js` or `styles-<hash>.css`:**
1. Compute the new hash: `md5 -q <file> | cut -c1-8`
2. Rename the file to the new hash: `mv app-<oldhash>.js app-<newhash>.js`
3. Update the `<script src="...">` or `<link href="...">` reference in `index.html` to the new filename
4. Do NOT keep both the old and new hashed files — delete the old one

`index.html` itself is never hashed; nginx serves it with `no-cache` so browsers always re-fetch it.

## Key Patterns

- **AI prompts** live inline in `server.py` inside the `analyze()` and `extract_meta()` functions — edit there to change AI behavior
- **Excel format** is hardcoded in `export_excel()` — column widths, borders, merged cells, and the footer signing section are all defined there
- **Bubble rendering** uses an SVG overlay; bubble positions are stored as percentages (`x_pct`, `y_pct`) relative to the displayed image size
- The UI is entirely in Chinese; keep any new UI strings in Chinese
