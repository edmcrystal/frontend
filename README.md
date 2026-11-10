# pptxConverter

Turns PDF and PPTX files into fully editable slide decks, with AI help to add
images, charts and infographics to each slide. See
[docs/editable-slides-plan.md](docs/editable-slides-plan.md) for the full plan, and
[docs/scanned-pdf-pipeline-plan.md](docs/scanned-pdf-pipeline-plan.md) for the server pipeline that converts flattened or scanned PDFs.

## Getting started

```bash
npm install
cp .env.example .env.local   # point at your backend
npm run dev
```

- http://localhost:3000 — chat demo (Jarvis streaming endpoint)
- http://localhost:3000/decks — your decks plus a sample deck; open one to edit it
- http://localhost:3000/decks/new — import a PowerPoint (.pptx) or PDF file

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build / server |
| `npm test` | Unit tests (vitest) |
| `npm run typecheck` | TypeScript check |

## Layout

```
app/                     routes (chat demo, /decks, /decks/[deckId])
components/editor/       slide editor (stage, toolbar, inspector, slide rail) and renderers
lib/api/                 backend config, fetch + CSRF client, SSE streaming
lib/deck/                deck schema (zod), editing commands, store + undo, geometry, text conversion, fixtures
lib/editor/              Tiptap setup for in-place text editing
lib/import/              in-browser importers: PPTX (OOXML → deck) and PDF (pdf.js text + cleaned page image)
components/import/       upload flow, import report, deck list
lib/charts/              ChartSpec -> ECharts conversion
docs/                    design docs
```

## Importing files

Imports run in the browser for now and are saved in the browser (IndexedDB), together with
autosaved edits. A server importer can replace the in-browser one later behind the same
`importFile()` interface (`lib/import/index.ts`).

- **PowerPoint (.pptx)** is rebuilt from the file's XML: text with fonts, sizes, colors,
  bullets and levels (including slide master/layout inheritance), shapes, pictures, groups,
  tables (with merged cells) and charts (with their data), speaker notes and backgrounds.
  SmartArt comes in as a group of shapes; unsupported shapes are drawn as rectangles and
  listed in the import report.
- **PDF** text becomes editable text boxes (lines are regrouped into paragraphs, bullets and
  numbering are detected, colors are sampled from the page). The text is erased from a
  rendered image of the page, which becomes the slide background, so pictures and drawings
  stay in that image. Scanned PDFs (no text layer) import as images only; they need OCR.

Test fixtures and their generator live in `lib/import/__fixtures__/`
(`python3 generate.py && soffice --headless --convert-to pdf sample.pptx`).

## Editor shortcuts

| Keys | Action |
|---|---|
| Click / Shift-click / drag on empty space | Select / add to selection / marquee |
| Double-click, Enter | Edit text (Esc to stop) |
| Tab / Shift+Tab (in text) | Indent / outdent |
| Arrows (Shift ×10) | Nudge |
| Ctrl+Z / Ctrl+Shift+Z | Undo / redo |
| Ctrl+C / X / V, Ctrl+D | Copy / cut / paste, duplicate |
| Ctrl+G / Ctrl+Shift+G | Group / ungroup |
| Ctrl+] / Ctrl+[ (Shift: to front/back) | Bring forward / send backward |
| Shift while resizing or rotating | Keep proportions / 15° steps |
| Alt while dragging or resizing | No snapping / resize from center |

## Configuration

| Variable | Default |
|---|---|
| `NEXT_PUBLIC_API_BASE_URL` | `http://localhost:8000` |
| `NEXT_PUBLIC_CHAT_COMPLETIONS_URL` | dev Jarvis chat-completions URL |
