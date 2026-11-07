# Implementation Plan: PDF/PPTX → Fully Editable Slide Decks, with AI Slide Enhancement

Status: Proposal · Owner: frontend + Jarvis backend · Last updated: 2026-11-07

---

## 1. Goals and non-goals

### Goals
1. **Import**: a user uploads a `.pdf` or `.pptx` and gets back a deck in which every
   visual element is a separate, editable object: text boxes with real text (font, size,
   color, alignment, bullets), images, vector shapes, tables, and charts. This should work
   the way Codia AI's "PDF/PPT → editable" works: it reconstructs layers, not a flat
   image of each page.
2. **Edit**: an in-browser slide editor (select, move, resize, rotate, rich text, z-order,
   group, undo/redo, slide reorder, themes).
3. **Enhance**: for each slide, AI looks at the content and suggests and inserts
   **images**, **charts/graphs**, **infographics**, and **icons** that fit it. Everything
   it inserts stays editable.
4. **Export**: native `.pptx` (editable in PowerPoint/Keynote/Google Slides) and `.pdf`.

### Non-goals (v1)
- Real-time multi-user collaboration (the data model below is ready for it; see Phase 6).
- Animations and transitions (kept from PPTX import where possible, but not editable).
- Perfect fidelity for every exotic PPTX feature (SmartArt internals, 3D, OLE objects).
  These come in as grouped shapes or images, marked as "approximated".

---

## 2. How Codia-style conversion works (what we are simulating)

Codia's pipeline, as far as its public behaviour shows, is "visual AI reconstruction":

| Stage | What happens | Our equivalent |
|---|---|---|
| 1. Page rasterize + parse | Each page is rendered to a high-res image. Any native objects (vector text, embedded images) are also extracted | PyMuPDF (PDF), OOXML parser (PPTX), LibreOffice for PPTX thumbnails |
| 2. Element detection | A vision model finds text blocks, images, icons, shapes, tables and charts with bounding boxes | Native objects first; layout-detection model + OCR for raster/flattened content |
| 3. Layer separation | Text and foreground objects are lifted off the background; the holes left behind are **inpainted** so the background stays clean | LaMa / OpenCV inpainting on the background plate |
| 4. Style recovery | Fonts, sizes, weights, colors, line spacing and alignment are estimated | PDF font metadata + font-matching classifier + color sampling |
| 5. Semantic grouping | Lines merge into paragraphs, paragraphs into text boxes; title/body/bullets/captions are tagged; reading order is fixed | Heuristics + vision-LLM refinement pass |
| 6. Rebuild | The result is written out as native editable objects (PPTX / Figma layers) | Our canonical `Deck` JSON → editor → PPTX exporter |

The key point: **use native vector data whenever it exists, and fall back to vision AI
only where content is rasterized** (scanned PDFs, text flattened into images, slides that
are a single full-bleed picture). That hybrid is what gives both high fidelity and full
editability.

---

## 3. System architecture

```
┌──────────────────────────── Next.js frontend (this repo) ───────────────────────────┐
│  /decks (list)   /decks/new (upload)   /decks/[id] (editor)                          │
│  ┌───────────┐  ┌──────────────┐  ┌─────────────────────────────────────────────┐   │
│  │ Uploader  │→ │ Job progress │→ │ Editor: canvas · inspector · slide rail ·   │   │
│  │ (presign) │  │ (SSE stream) │  │ Enhance panel (AI) · export                 │   │
│  └───────────┘  └──────────────┘  └─────────────────────────────────────────────┘   │
│         │  zustand store (Deck JSON) + immer patches + undo/redo                     │
└─────────┼───────────────────────────────────────────────────────────────────────────┘
          │ REST + SSE (CSRF token, existing pattern)
┌─────────▼──────────────────────── Jarvis backend (API) ─────────────────────────────┐
│  /v1/decks  /v1/imports  /v1/jobs/{id}/events (SSE)  /v1/enhance  /v1/exports        │
│  Postgres (decks, slides, assets, jobs) · S3/GCS object storage · Redis queue        │
└─────────┬───────────────────────────────────────────────────────────────────────────┘
          │ job queue (Celery/RQ/Arq)
┌─────────▼──────────────── Conversion workers (Python, GPU pool optional) ───────────┐
│ pdf_parser · pptx_parser · rasterizer · layout_detector · ocr · inpainter ·          │
│ font_matcher · chart_extractor · semantic_refiner (vision LLM) · pptx_exporter       │
└─────────────────────────────────────────────────────────────────────────────────────┘
          │
   External: LLM (Jarvis /chat/completions, vision-capable model), image generation,
   stock photos (Unsplash/Pexels), icon library (Iconify)
```

**Why the heavy lifting runs server-side:** PDF/PPTX parsing, OCR, inpainting and
LibreOffice all need native libraries, GPUs and sandboxing. The frontend only works with
the canonical `Deck` JSON.

---

## 4. Canonical data model (the contract between every component)

Every importer writes it, the editor edits it, every exporter reads it. Define it once in
TypeScript (`lib/deck/schema.ts`, with zod), generate JSON Schema from that, and generate
Pydantic models for the backend from the JSON Schema (`datamodel-code-generator`) so the
two sides never drift.

```ts
// Units: points (1/72 in). Slide 16:9 default = 960 x 540 pt (PPTX 13.333in x 7.5in).
type Deck = {
  id: string; title: string; version: number;
  size: { width: number; height: number };
  theme: Theme;                      // colors, fonts, master backgrounds
  slides: Slide[];
  assets: Record<string, Asset>;     // images/fonts referenced by id
  source?: { kind: "pdf" | "pptx"; fileId: string; pageCount: number };
};

type Slide = {
  id: string;
  background: Fill;                  // solid | gradient | image(assetId) (inpainted plate)
  elements: Element[];               // z-order = array order
  notes?: string;
  layoutHint?: "title" | "title-content" | "two-column" | "section" | "blank" | string;
  thumbnailUrl?: string;
};

type BaseElement = {
  id: string; name?: string;
  frame: { x: number; y: number; w: number; h: number; rotation: number }; // pt, deg
  opacity?: number; locked?: boolean; hidden?: boolean;
  provenance?: {                     // drives "review low-confidence items" UI
    source: "native" | "ocr" | "vision" | "ai-generated" | "user";
    confidence?: number;             // 0..1
    approximated?: boolean;          // e.g. SmartArt flattened
  };
};

type TextElement = BaseElement & {
  type: "text";
  role?: "title" | "subtitle" | "body" | "bullet" | "caption" | "footer";
  autofit: "none" | "shrink" | "resize";
  padding: [number, number, number, number];
  verticalAlign: "top" | "middle" | "bottom";
  paragraphs: Paragraph[];           // rich text tree (maps 1:1 to DrawingML <a:p>/<a:r>)
};
type Paragraph = { align: "left"|"center"|"right"|"justify"; lineHeight?: number;
  spaceBefore?: number; spaceAfter?: number; bullet?: Bullet; level: number; runs: Run[] };
type Run = { text: string; font: string; size: number; bold?: boolean; italic?: boolean;
  underline?: boolean; color: string; highlight?: string; link?: string };

type ImageElement = BaseElement & { type: "image"; assetId: string;
  crop?: { l: number; t: number; r: number; b: number }; mask?: "rect"|"ellipse"|"rounded" };
type ShapeElement = BaseElement & { type: "shape";
  geometry: { preset: PresetShape } | { path: string /* SVG path d */ };
  fill: Fill; stroke?: Stroke; text?: TextElement["paragraphs"] };
type TableElement = BaseElement & { type: "table"; columns: number[]; rows: TableRow[] };
type ChartElement = BaseElement & { type: "chart"; spec: ChartSpec };     // see §8.2
type IconElement  = BaseElement & { type: "icon"; svg: string; color: string; iconId?: string };
type GroupElement = BaseElement & { type: "group"; children: Element[];
  infographic?: { templateId: string; data: unknown } };                 // see §8.3
type Element = TextElement | ImageElement | ShapeElement | TableElement
             | ChartElement | IconElement | GroupElement;
```

Design rules:
- **The geometry model matches PPTX/DrawingML** (points ↔ EMU via ×12700), so export does
  not lose anything to rounding.
- **Text is a paragraph/run tree**, not HTML. The editor converts it to and from the
  rich-text editor's document.
- **Charts and infographics are data plus a renderer**, never baked images. That keeps
  them editable after insertion and lets them export as native PPTX charts or shape groups.
- **`provenance.confidence`** feeds a "Review" mode that highlights OCR/vision guesses the
  user should check.

---

## 5. Import pipeline (backend workers)

### 5.1 Job orchestration
1. `POST /v1/imports` → returns a presigned upload URL and an `importId`.
2. The client uploads directly to object storage, then calls `POST /v1/imports/{id}/start`.
3. The worker runs the steps below, one task per page/slide so pages run in parallel, and
   sends progress events to `GET /v1/jobs/{id}/events` (SSE):
   `{"stage":"detect","page":3,"of":20,"pct":42}` and a final
   `{"stage":"done","deckId":"..."}`.
4. Partial results stream out: each slide is saved as soon as it finishes, so the editor
   can open slide 1 while slide 20 is still processing.

### 5.2 PPTX path (mostly native, high fidelity)
PPTX is already structured, so the job is a **faithful parse**, not recognition.
1. Unzip and parse OOXML: `presentation.xml`, slide masters, layouts, slides, theme.
   Use `python-pptx` for the object model and drop to raw `lxml` for anything it doesn't
   expose: gradients, custom geometry (`a:custGeom`), placeholder inheritance, grouping
   transforms, table cell styles, chart XML (`c:chartSpace`).
2. **Resolve inheritance**: slide → layout → master → theme, for placeholders, text styles
   and color-scheme references (`schemeClr` with lumMod/lumOff). Flatten into explicit
   values in our model, and keep the theme reference so the theme can be switched later.
3. Charts: read the `c:chart` XML (series, categories, values, chart type) into a
   `ChartSpec`. That makes them fully editable at no extra cost.
4. SmartArt / OLE / 3D / WordArt: use the fallback image from the drawing part, or
   rasterize through LibreOffice, and set `approximated: true`. Phase 5 adds SmartArt →
   infographic-template mapping.
5. Fonts: list the fonts used, extract embedded fonts where licensing permits, and map the
   rest through the font matcher (§5.5).
6. Thumbnails: `soffice --headless --convert-to pdf`, then PyMuPDF rasterizes each page.
   The result is the **reference render** for fidelity QA (§10).

### 5.3 PDF path (hybrid: native extraction + vision AI)
Each page is classified first:

| Class | Detection rule | Strategy |
|---|---|---|
| **Digital** | ≥ 80% of the page's visible ink comes from text/vector operators | Native extraction only |
| **Mixed** | Native text exists, plus large raster images that contain text (OCR finds text in the image) | Native, plus vision on the image regions |
| **Scanned / flattened** | One full-page image, no or negligible native text | Full vision pipeline |

**Native extraction (PyMuPDF `page.get_text("rawdict")`, `get_drawings()`, `get_images()`):**
- Text spans come with font name, size, flags (bold/italic), color and origin. Merge them
  into lines, then into paragraphs (gap and indent heuristics, same font family, aligned
  left edges or centers), then into text boxes (vertical proximity, shared alignment axis,
  column detection with an XY-cut algorithm).
- Bullets: a leading glyph (•, ▪, –, numbers + ".") with a hanging indent becomes a
  `Bullet` and a paragraph `level`.
- Vector drawings: rectangles, rounded rectangles and ellipses map to preset shapes; any
  other path becomes an SVG `path`. Fill and stroke are kept. Merge tiny line segments.
  Ruling-line grids are table candidates.
- Tables: `pdfplumber` / PyMuPDF `find_tables()` on ruling lines, plus text-alignment
  clustering for borderless tables, produce a `TableElement`.
- Images: extract at native resolution, apply soft masks (SMask) for transparency, and
  use the drawn bbox and transform for frame and rotation.
- Background: a full-bleed image or rect at the bottom of the z-order becomes the
  `slide.background`.

**Vision pipeline (scanned pages and image regions with text):**
1. Rasterize at 200–300 DPI.
2. **Layout detection** with a document-layout model (DocLayout-YOLO or PaddleOCR
   PP-Structure / PP-DocLayout). Classes: title, text, list, table, figure, chart, icon,
   logo, shape. Fine-tune on slide-like data (rendered PPTX corpus, §10.2), because
   off-the-shelf models are trained on papers and documents.
3. **OCR** (PaddleOCR PP-OCRv4 or a cloud OCR as a configurable provider) gives line-level
   text, polygons and per-character confidence.
4. **Text style estimation** per line:
   - size: cap height / x-height from glyph boxes, converted to pt with the DPI;
   - color: k-means (k=2) on the pixels inside the glyph mask; the color that isn't the
     background is the text color;
   - weight/italic and family: font classifier (§5.5).
5. **Layer separation + inpainting**: build a mask from the OCR polygons and the
   detected icons/figures (dilated 2–4 px), then run **LaMa** (big-lama, ONNX on GPU,
   with an OpenCV Telea fallback on CPU) over the page raster. The output is a clean
   background plate with the text removed. Figures cut out on their own become separate
   `ImageElement`s, with alpha matting (e.g. rembg/U²-Net) for non-rectangular objects.
6. **Shapes on raster**: flat-color regions (connected components + contour
   approximation) become preset shapes when the fit is good (IoU > 0.9); otherwise they
   stay part of the background plate.
7. **Charts in images**: send the crop to the chart extractor (§5.6).

### 5.4 Semantic refinement (vision LLM pass, per slide)
After the geometric pass, send the slide raster **plus a compact JSON of the detected
elements** (ids, bbox, text, style) to a vision-capable model through Jarvis with a
strict JSON-schema response. It returns **only edits**, it never invents content:
- merge/split decisions for text boxes ("ids 4,5,6 are one bulleted list");
- `role` tags (title/subtitle/body/caption/footer/page-number);
- reading order;
- `layoutHint` for the slide;
- grouping (an icon and its label → group);
- detection of "this image is actually a chart/diagram" → route to the chart extractor.

Validate the edits against the schema and apply them only if they pass sanity checks (no
text lost, bboxes stay inside the slide). If the LLM fails, keep the heuristic result.
The pass can be turned off for cost control.

### 5.5 Font matching
1. PDF: the font name is often a subset name such as `ABCDEF+Montserrat-SemiBold`. Strip
   the prefix and parse the family and weight.
2. Look the family up in a font registry (Google Fonts catalogue plus a list of common
   system fonts) → web-loadable family.
3. If there is no match or the font is unknown (always the case for OCR text): run a
   **font-classifier** (a CNN embedding of rendered text crops; nearest neighbour over a
   Google Fonts embedding index) and take the top match. Keep the original name in
   metadata for PPTX export so the deck renders correctly if the user has the font.
4. Metric fit: tune `letterSpacing` / size slightly so the matched font's line width stays
   within ±2% of the original, which prevents reflow.
5. Embedded font files (where the license allows) are stored as `Asset`s and loaded with
   `@font-face`, for the closest match to the original.

### 5.6 Chart extraction (image → editable chart)
1. Classify the chart type (bar/column/line/pie/donut/scatter/area/stacked) with the
   vision LLM or a small classifier.
2. Extract data with the vision LLM (structured output: title, axes, categories, series,
   values, legend colors). If precision matters, cross-check bar heights and point
   positions against detected axis ticks (OCR'd tick labels → linear axis calibration).
3. Output a `ChartSpec` with `provenance.confidence`. If confidence is below 0.6, insert
   the chart *and* keep the original image hidden underneath. The UI then offers
   "Compare with original / revert to image".

### 5.7 Output assembly
Write the `Deck`, upload assets (background plates, cropped images, embedded fonts), and
create thumbnails. Store the raw intermediate artefacts (detections, OCR, masks) for 30
days so a page can be re-processed with different settings ("Re-convert this slide as:
more editable / more faithful").

---

## 6. Frontend: slide editor (this repo)

### 6.1 Rendering technology decision
**Recommendation: DOM + SVG rendering, not a `<canvas>` library.**
- Text boxes are absolutely positioned `<div>`s rendered from the paragraph/run tree.
  Editing them is real rich-text editing (IME, spellcheck, selection, copy/paste), which
  canvas libraries (Konva, Fabric) do poorly.
- Shapes, icons and custom paths render as inline SVG. Charts render with ECharts using
  its SVG renderer. Images are `<img>` with CSS crop/mask.
- The slide is a fixed 960×540 pt stage, scaled with a CSS `transform: scale()` to fit
  the viewport. Thumbnails reuse the same renderer at a small scale (memoized).
- The same renderer, run through Playwright, produces PDF export and QA screenshots
  server-side. One renderer means one source of truth.

### 6.2 Libraries
| Concern | Choice | Notes |
|---|---|---|
| State | `zustand` + `immer` | Immutable deck; `produceWithPatches` can supply diffs for the server API and future CRDT sync |
| Undo/redo | Snapshot stack of immutable decks (structural sharing keeps it cheap), coalescing for drags/typing | Cap at 200 steps. *Built this way instead of a patch stack: simpler, same memory cost.* |
| Transform handles | Custom pointer handling (`lib/deck/geometry.ts`) | Move/resize/rotate, snapping guides, marquee. *Built in-house instead of `react-moveable`: rotation-aware resize inside a CSS-scaled stage is easier to get right and unit-test ourselves.* |
| Rich text | `tiptap` (ProseMirror), mounted only on the text box being edited | Custom marks for font/size/color; converts to/from `Paragraph[]` |
| Charts | `echarts` (SVG renderer) | ChartSpec → ECharts option; also used in the chart data editor |
| Slide reorder | `@dnd-kit/sortable` | |
| Schema/validation | `zod` | Shared schema (§4) |
| Data fetching | `@tanstack/react-query` | Decks, assets, suggestions |
| Upload | Presigned PUT with progress (XHR) | Chunked/multipart for files > 50 MB |
| Icons | Iconify API (`@iconify/react`) | Searchable; inserted as inline SVG |
| PPTX export (client fallback) | `pptxgenjs` | Primary export is server-side (§9) |

### 6.3 Proposed file layout
```
app/
  decks/page.tsx                    # deck list
  decks/new/page.tsx                # upload + import progress
  decks/[deckId]/page.tsx           # editor shell (client component)
  api/…                             # (optional) BFF routes proxying to Jarvis
components/editor/
  EditorShell.tsx                   # layout: toolbar · slide rail · stage · inspector
  Toolbar.tsx                       # insert, align, arrange, undo/redo, zoom, export
  SlideRail.tsx                     # thumbnails, dnd reorder, add/duplicate/delete
  Stage.tsx                         # scaled slide, selection, moveable
  renderers/                        # TextRenderer, ImageRenderer, ShapeRenderer,
                                    # TableRenderer, ChartRenderer, IconRenderer, GroupRenderer
  inspector/                        # TextPanel, FillStrokePanel, ArrangePanel, ChartDataPanel…
  review/LowConfidenceOverlay.tsx   # highlights OCR/vision items to check
  enhance/EnhancePanel.tsx          # AI suggestions (see §8)
components/import/
  Uploader.tsx  ImportProgress.tsx
lib/
  api/client.ts                     # fetch wrapper with CSRF (extract from app/page.tsx)
  api/sse.ts                        # SSE-over-fetch helper (refactor EventSourcePolyfill)
  deck/schema.ts                    # zod schema + types (source of truth)
  deck/store.ts                     # zustand store, actions, patches, history
  deck/commands.ts                  # addElement, updateFrame, group, align, distribute…
  deck/geometry.ts                  # snapping, bounding boxes, rotation math
  deck/text.ts                      # Paragraph[] <-> tiptap JSON
  deck/autosave.ts                  # debounced PATCH with patches + version
  charts/toEcharts.ts
  infographics/templates/*.ts       # template definitions (§8.3)
  infographics/layout.ts            # data -> positioned shapes/text
```

The existing `EventSourcePolyfill` and CSRF logic in `app/page.tsx` should move into
`lib/api/sse.ts` and `lib/api/client.ts`. Fix the current `new TextDecoder()` per chunk
(use one decoder with `{ stream: true }`), handle `\r\n\r\n` separators, and make the
backend base URL configurable via `NEXT_PUBLIC_API_BASE_URL` instead of hard-coding
`localhost:8000` and the dev Jarvis URL.

### 6.4 Editor features (v1 scope)
- Select, multi-select, marquee; move, resize (aspect lock with Shift), rotate; snapping
  to slide edges, centers and other elements; smart spacing guides.
- Text: inline editing; font family/size/color/bold/italic/underline; alignment, line
  spacing, bullets and levels, autofit; paste as plain text.
- Arrange: z-order, group/ungroup, align/distribute, lock/hide, layers panel.
- Images: replace, crop, mask, opacity; drag-and-drop from desktop.
- Shapes: preset library, fill/stroke/gradient, text inside shapes.
- Tables: edit cells, add/remove rows/cols, cell fill.
- Charts: change type, edit data in a grid (paste from Excel/Sheets), colors, legend.
- Slides: add/duplicate/delete/reorder, background, speaker notes.
- Theme: switch the palette/fonts across the whole deck, using the theme references kept
  at import.
- Review mode: step through low-confidence elements; accept, fix, or "revert to original
  pixels" (re-show the original raster crop).
- Keyboard shortcuts, copy/paste between slides and decks (custom clipboard MIME with
  element JSON), zoom, presenter preview.
- Autosave: debounced patches to `PATCH /v1/decks/{id}` with optimistic `version`
  checks; offline queue in IndexedDB.

### 6.5 Performance
- Each slide's rendered thumbnail is memoized by a content hash; the rail virtualizes for
  decks with 100+ slides.
- Only the active slide mounts interactive layers (moveable, tiptap).
- Fonts load lazily per deck with `FontFace`; show a fallback until `document.fonts.ready`
  so text doesn't jump.
- Large images: the backend generates resized variants (thumb/screen/original); the stage
  uses `srcset`.

---

## 7. Backend API (Jarvis) — contract summary

| Method & path | Purpose |
|---|---|
| `POST /v1/imports` | `{filename, size, mime}` → `{importId, uploadUrl}` |
| `POST /v1/imports/{id}/start` | `{options: {mode: "editable"\|"faithful", ocrLanguage, llmRefine: bool}}` → `{jobId}` |
| `GET /v1/jobs/{id}/events` (SSE) | progress, `slide_ready`, `done`, `error` events |
| `GET /v1/decks` / `GET /v1/decks/{id}` | list / fetch Deck JSON |
| `PATCH /v1/decks/{id}` | `{baseVersion, patches}` → `{version}` (409 on conflict) |
| `POST /v1/decks/{id}/slides/{sid}/reconvert` | re-process one slide with other options |
| `POST /v1/assets` | presigned upload for user images |
| `POST /v1/enhance/suggest` (SSE) | slide → stream of suggestions (§8) |
| `POST /v1/enhance/images/search` | stock photo search |
| `POST /v1/enhance/images/generate` | AI image generation (async job) |
| `POST /v1/exports` | `{deckId, format: "pptx"\|"pdf"}` → `{jobId}`, then a download URL |

All mutating requests carry the existing `X-CSRF-TOKEN` header. Rate-limit per user
(imports and AI generation are the expensive endpoints).

---

## 8. AI slide enhancement

### 8.1 Flow
1. The user opens the **Enhance** panel on a slide (or runs "Enhance whole deck").
2. The frontend sends a **slide digest** to `POST /v1/enhance/suggest`: the text by role,
   any numbers/tables found, the deck title and topic, neighbouring slide titles for
   context, the theme palette, and the **free regions** of the slide (computed client-side
   from element bboxes).
3. The backend calls the LLM (through the existing Jarvis chat-completions endpoint;
   upgrade from `gpt-3.5-turbo` to a model that supports structured output and vision)
   with a JSON-schema response format. It streams back suggestion cards:
   ```json
   { "kind": "chart",       "rationale": "Slide lists quarterly revenue figures",
     "spec": { "type": "column", "categories": ["Q1","Q2","Q3","Q4"],
               "series": [{"name":"Revenue ($M)","values":[1.2,1.8,2.1,2.9]}] },
     "placement": "right-half" }
   { "kind": "infographic", "templateId": "process-4-step", "data": { "steps": [...] } }
   { "kind": "image",       "query": "team collaborating whiteboard", "style": "photo",
     "generatePrompt": "...", "placement": "left-third" }
   { "kind": "icons",       "items": [{"targetElementId":"el_12","iconQuery":"shield security"}] }
   ```
4. Each card renders a **live preview** using the real renderers on a scaled copy of the
   slide. Users can **Insert**, **Shuffle** (another variant), or **Edit before insert**.
5. Insertion is a normal store command (undoable) with
   `provenance.source = "ai-generated"`.

**Grounding rule:** charts and infographics may only use numbers and facts that appear
in the slide or deck text. The prompt says so, and a server-side validator checks that
each numeric value in a chart spec appears in the source text. Anything that fails is
dropped, or marked "illustrative data — please edit" when the user explicitly asks for
an example.

### 8.2 Charts and graphs
- `ChartSpec` = `{ type, title?, categories, series[{name, values, color?}], axes?,
  legend?, dataLabels?, stacked? }`. Types: bar, column, line, area, pie, donut, scatter,
  combo, plus KPI "big number" tiles.
- Data comes from (a) numbers parsed from slide text and tables, (b) a table on the
  slide (offer "Turn this table into a chart"), (c) the user pasting data in the grid
  editor.
- The LLM picks the chart type, with a rule-based fallback: time series → line, parts of
  a whole with ≤ 6 parts → donut, category comparison → column.
- Colors come from the deck theme palette.
- Rendered with ECharts in the editor; exported as **native PPTX charts** (§9), so they
  stay editable in PowerPoint.

### 8.3 Infographics
Infographics are **parametric templates**: a schema for the data, plus a layout function
that turns the data into positioned shapes, text and icons inside a `GroupElement`.
After insertion every piece is a normal editable element, and the group keeps
`infographic.{templateId, data}` so it can be regenerated when the data changes (e.g.
adding a step re-runs the layout).

Starter template library (~20):

| Family | Templates | Triggered by content like |
|---|---|---|
| Process | 3/4/5-step chevrons, numbered steps, arrows | "First… then… finally", ordered lists |
| Timeline | horizontal, vertical, milestone | dates, years, phases |
| Comparison | 2-column vs, pros/cons, feature matrix | "vs", "compared to", pros/cons |
| Hierarchy | pyramid, org tree, funnel | levels, stages that narrow down |
| Cycle | 3–6 node cycle, flywheel | "loop", "continuous", "cycle" |
| Stats | KPI tiles, icon + number grid, progress bars | percentages, standalone metrics |
| List | icon bullet list, card grid, hub-and-spoke | 3–8 parallel bullet points |

- Each template = `{ id, name, dataSchema (zod), minItems, maxItems, layout(data, frame,
  theme) => Element[], preview }`. They live in `lib/infographics/templates/` so the
  frontend renders previews instantly with no round trip. The backend gets the template
  catalogue (id + description + dataSchema) to choose from.
- The LLM picks a template **and** fills its data from the slide's bullets (it shortens
  labels and picks an icon query per item). An option "Replace bullets with infographic"
  removes the original text box.
- Icons inside templates come from Iconify, chosen with the per-item icon query and
  colored with the theme.

### 8.4 Images
Two sources, shown side by side in the panel:
1. **Stock**: Unsplash/Pexels API search with the LLM-built query; results filtered by
   orientation to fit the target region. Attribution is stored in asset metadata (and
   added to notes when the provider requires it).
2. **AI-generated**: an image-generation provider (configurable) using
   `generatePrompt` plus a deck-level **style lock** (e.g. "flat illustration, brand
   palette #0B5FFF/#FFB800"), so images stay consistent across slides. Runs as an async
   job and the card shows progress.

Placement: insert into the suggested free region with `object-fit: cover` crop, and offer
an optional mask (rounded/circle). If no region is large enough, offer **layout
variants** (§8.5).

### 8.5 Layout assistance
- **Free-space finder**: a maximal-empty-rectangle algorithm over element bboxes, with a
  margin. Gives the candidate regions for any insertion.
- **Re-layout variants**: when content doesn't fit, generate 2–3 alternative layouts
  (text left / visual right, visual top / text bottom, full-bleed image with text
  overlay) by moving and resizing existing elements with constraint rules: keep
  title-on-top, minimum font size 14 pt, keep margins. The user picks one, and it can be
  undone.
- **Contrast check**: text over images gets an automatic scrim or text color flip if the
  WCAG contrast ratio is below 4.5:1.

### 8.6 Deck-level enhancement
"Enhance deck" runs the suggest flow for every slide in a background job, applies
**at most one** visual per slide automatically (when the user enables auto-apply),
otherwise queues suggestions, and shows a slide-by-slide review list. A cost/credit
estimate is shown before it runs.

---

## 9. Export

### 9.1 PPTX (server-side, Python)
- `python-pptx` + `lxml` writer driven by the `Deck` JSON:
  - text → `p:sp` text body with `a:p`/`a:r`; fonts by name (embedded where licensed);
    autofit flags; bullets (`a:buChar` / `a:buAutoNum`);
  - shapes → preset geometry or `a:custGeom` (SVG path → DrawingML path commands);
  - images → `p:pic` with `a:srcRect` crop;
  - tables → `a:tbl`;
  - charts → native `c:chartSpace` parts with an embedded workbook (python-pptx chart API),
    so the charts stay editable;
  - icons → SVG images (`asvg:svgBlip` with a PNG fallback);
  - groups/infographics → `p:grpSp`;
  - backgrounds (incl. inpainted plates) → `p:bg` with a picture fill;
  - speaker notes.
- When the source was a PPTX, **round-trip preservation**: keep the original master,
  layouts and theme parts and write changed slides against them. Unknown XML on
  untouched elements passes through unchanged.
- `pptxgenjs` client-side export is an offline fallback.

### 9.2 PDF
Render each slide with the same React renderer in headless Chromium (Playwright,
`page.pdf()` with the slide size), so the PDF looks the same as the editor.

---

## 10. Quality, testing and metrics

### 10.1 Automated fidelity scoring (CI + nightly)
For each document in a test corpus: import → export to PDF → rasterize → compare with
the original rendering:
- **Visual**: SSIM / LPIPS per slide (target SSIM ≥ 0.92 for digital PDFs and PPTX).
- **Text**: character-level recall/precision of the reconstructed text against ground
  truth (target ≥ 99% digital, ≥ 95% scanned).
- **Editability**: % of the page area that is covered by editable elements, not baked
  into the background (target ≥ 90% of text pixels).
- **Geometry**: mean IoU of text-box bboxes against ground truth.
- **Chart data**: mean absolute percentage error on extracted values (target ≤ 5%).

### 10.2 Test corpus
- ~300 real decks (licensed or permissively shared), both PPTX and "exported to PDF".
- **Synthetic**: generate thousands of PPTX files from templates with known ground truth,
  export them to PDF and rasterized/"scanned" PDF (with noise, skew, JPEG artefacts). This
  is also the fine-tuning data for the layout detector (§5.3).

### 10.3 Unit and integration tests
- Frontend: `vitest` + Testing Library for the store, commands, the text converter and
  infographic layouts (snapshot the element output); Playwright E2E for upload → edit →
  export.
- Backend: pytest per pipeline stage with golden files; property tests for unit
  conversions; schema-compat tests between the TS zod schema and the Pydantic models.

### 10.4 Product metrics
Import success rate, p50/p95 time per page, % of slides opened in Review mode, edits per
imported slide (lower is better fidelity), suggestion insert rate per kind, and export
success rate.

---

## 11. Security, privacy and operations
- **Uploads**: max 100 MB / 300 pages; MIME sniffing plus magic-byte checks; reject
  encrypted PDFs (or prompt for the password); decompression-bomb limits for PPTX zip
  entries and PDF streams.
- **Sandboxing**: LibreOffice and the parsers run in an unprivileged container with no
  network and CPU/memory/time limits (seccomp, gVisor or Firecracker).
- **Content safety**: pass AI-generated images and prompts through moderation.
- **Data**: files are encrypted at rest; source files and intermediates are deleted after
  the retention window; a per-user/org "do not send to third-party AI" setting disables
  the LLM refine and cloud OCR providers.
- **Licensing**: track font embedding rights (OS/2 `fsType`) and stock photo attribution.
- **Cost controls**: cache LLM results per slide content hash; LLM refine is optional;
  batch GPU inference; per-plan quotas.
- **Observability**: per-stage timing and failure metrics; store the failing page with
  its artefacts for debugging (when the user consents).

---

## 12. Phased delivery

| Phase | Scope | Exit criteria | Est. |
|---|---|---|---|
| **0. Foundations** | Shared schema (zod → JSON Schema → Pydantic); refactor `lib/api` (CSRF, SSE, env-based URLs); deck CRUD API + storage; upload + job/SSE progress | Upload a file, see job progress, open an empty deck | 2 wks |
| **1. PPTX import + core editor** | PPTX parser (text, shapes, images, tables, groups, theme inheritance); editor: render, select/move/resize/rotate, text editing, slide rail, undo/redo, autosave | 90% of corpus PPTX decks open with SSIM ≥ 0.92; all core edits work | 4–5 wks |
| **2. PPTX/PDF export** | Server PPTX exporter (incl. round-trip), Playwright PDF export | Import → export → opens in PowerPoint/Keynote/Google Slides with no repair prompt | 2 wks |
| **3. Digital PDF import** | PyMuPDF extraction, paragraph/box grouping, bullets, tables, vector shapes, font matching | Digital PDF corpus: text recall ≥ 99%, SSIM ≥ 0.9 | 3–4 wks |
| **4. Vision pipeline** | Page classifier, layout detection, OCR, inpainting, raster shapes, LLM semantic refinement, Review mode, per-slide reconvert | Scanned corpus: text recall ≥ 95%, editability ≥ 90% | 5–6 wks |
| **5. AI enhancement** | Suggest API + Enhance panel; charts (incl. native PPTX charts, table → chart, chart extraction from images); infographic template library (~20); images (stock + generated); icons; free-space finder + layout variants; deck-level enhance | ≥ 30% of suggestion cards get inserted in usability tests; grounding validator passes 100% | 5–6 wks |
| **6. Hardening & extras** | Performance (100+ slide decks), accessibility, i18n OCR languages, SmartArt → infographic mapping, collaboration via Yjs on top of the patch model | — | ongoing |

Phases 3–4 (backend) and 1–2 (editor) can run in parallel once Phase 0 has fixed the
schema.

---

## 13. Key risks and mitigations

| Risk | Mitigation |
|---|---|
| Font mismatch makes text reflow and overflow boxes | Metric-fit adjustment, `autofit: shrink` default for imported boxes, embedded fonts where allowed |
| Over-segmentation (every line becomes its own box) hurts editability | Grouping heuristics + LLM merge pass; "merge text boxes" command in the editor |
| Inpainting artefacts on complex backgrounds | "Faithful" mode keeps the original raster under the text (text gets `hidden` original crop); per-slide reconvert |
| LLM hallucinated chart data | Grounding validator; "illustrative data" labelling; never auto-apply ungrounded charts |
| GPU cost/latency for scanned docs | Page classifier routes only the pages that need vision; batch inference; CPU fallbacks |
| PPTX round-trip breaks complex decks | Preserve untouched XML; "repair-free" check (open in LibreOffice + OOXML validator) in CI |
| Rendering differs between the editor and PowerPoint | One DOM renderer for editor and PDF; maintain a PPTX-vs-editor diff suite for text metrics |

---

## 14. Immediate next steps (first PRs in this repo)
1. ~~`lib/api/client.ts`, `lib/api/sse.ts`: move CSRF + SSE out of `app/page.tsx`, fix the
   decoder/separator handling, add `NEXT_PUBLIC_API_BASE_URL`.~~ Done.
2. ~~`lib/deck/schema.ts`: the zod schema from §4 with fixtures.~~ Done.
3. `components/editor/renderers/*`: read-only rendering of the fixture decks at
   `/decks/[id]`. This is the base for both the editor and the PDF export. *(Done.)*
4. ~~`lib/deck/store.ts` + Stage: selection, move/resize, undo/redo.~~ Done (custom handles, Tiptap text editing, inspector, slide rail, local autosave).
5. Backend ticket: `/v1/imports` + job SSE + the PPTX parser spike against the fixtures.
