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
- http://localhost:3000/decks — decks (currently a built-in sample deck)

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
components/editor/       deck viewer and slide renderers
lib/api/                 backend config, fetch + CSRF client, SSE streaming
lib/deck/                deck schema (zod), render helpers, fixtures
lib/charts/              ChartSpec -> ECharts conversion
docs/                    design docs
```

## Configuration

| Variable | Default |
|---|---|
| `NEXT_PUBLIC_API_BASE_URL` | `http://localhost:8000` |
| `NEXT_PUBLIC_CHAT_COMPLETIONS_URL` | dev Jarvis chat-completions URL |
