# pptxConverter

Turns PDF and PPTX files into fully editable slide decks, with AI help to add
images, charts and infographics to each slide. See
[docs/editable-slides-plan.md](docs/editable-slides-plan.md) for the full plan.

## Getting started

```bash
npm install
cp .env.example .env.local   # point at your backend
npm run dev
```

- http://localhost:3000 — chat demo (Jarvis streaming endpoint)
- http://localhost:3000/decks — decks; open one to edit it (currently a built-in sample deck; edits autosave to your browser)

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
lib/charts/              ChartSpec -> ECharts conversion
docs/                    design docs
```

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
