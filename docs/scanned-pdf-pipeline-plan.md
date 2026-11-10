# Plan: Server Pipeline for Flattened and Scanned Slides (Codia-style conversion)

Status: Proposal · Extends §5.3–5.4 of [editable-slides-plan.md](editable-slides-plan.md) · Last updated: 2026-11-10

Numbers marked **(target)** are goals to validate, not measurements. Model and library names are
candidates to be confirmed in the Phase 0 spikes, including their licences.

---

## 1. Why this exists

`Spatial_AI_Developer_Guide.pdf` (14 pages, exported from an AI slide generator) shows the gap. Every page is a
single 1376×768 raster image. The file has no fonts, no text layer and no vector art. The in-browser importer
correctly produces 14 background-only slides with zero editable elements, because there is no structure to read.
Anything that is only pixels needs a vision pipeline:

> **pixels → find things → decide what each thing is → rebuild it as editable objects → check the result looks like the original**

The browser importer stays in place for PPTX and for PDFs that have a text layer. This plan adds a server
importer for everything else: scanned documents, screenshots, AI-generated slide images and PDFs of pictures.

### What "success" means for the example PDF

| Slide content | Today | After this plan |
|---|---|---|
| Titles, body text, captions, labels | Picture | Editable text in the right font, size, colour, alignment |
| Code blocks with syntax colours | Picture | Editable monospace text with per-token colour runs |
| Pill labels, cards, panels, table frames | Picture | Editable rounded rectangles, rectangles and lines, with their text inside |
| Block arrows, connectors, cylinders | Picture | Editable shapes where they fit cleanly; traced vector paths otherwise |
| Illustrations (the hex globe), UI screenshots | Picture | Separate movable image objects with transparency |
| Stacked bar chart (slide 4) | Picture | Native chart when the data can be recovered, else shapes |
| Map screenshots and dense data pictures in cards (slides 5, 6, 11) | Picture | Separate movable pictures. Text and controls *inside* them stay part of the picture |
| Tables with filled header cells (slide 8) | Picture | Editable table. A tiny table drawn inside an illustration (slide 10) stays a picture |
| Icon sets in cards (slides 7, 11, 13) | Picture | Separate icon cut-outs (or traced paths), grouped with their card |
| Hub diagram: ring, diagonal block arrows, corner-bracket cards (slide 13) | Picture | Editable ring, rotated arrows and cards, grouped |
| Mixed styles inside one line (bold lead-ins on slides 9/13, monospace inside a sentence on slide 6, coloured code tokens) | Picture | One text box with per-run font family, weight and colour |
| URLs such as `bit.ly/GeocodingSprint` (slide 14) | Picture | Text with a link attached |
| Soft drop shadows on cards (slides 7, 9, 11) | Picture | Optional shadow property on the shape, or dropped cleanly |
| Footer brand mark, same place on all 14 slides | Picture | Left in the background by default; not turned into 14 text boxes |
| Faint line art behind or across titles (slides 1, 14) | Picture | Stays in the background; the title is painted out of it cleanly |
| Paper-texture background | Picture with text still baked in | Clean background with text, shapes and figures removed |

Expectations to set with users: OCR copies typos that are baked into the image ("Develloper's", "sdo_lonlati").
At 72 ppi, small text reads less reliably. Faded decorative text behind illustrations (slide 1) should be left alone.
Text that is part of a screenshot or tiny illustration (slides 6, 10, 12) is deliberately *not* extracted.
Fonts differ from slide to slide in this deck (light, regular and bold sans-serifs, a monospace for code), so a
deck-level pass is needed to unify them (Stage 8).

---

## 2. Core design: route every detected thing to the cheapest faithful representation

Each region found on a slide is routed to one of four representations, by how well it fits:

| Route | Used for | Editable how |
|---|---|---|
| **A. Parametric shape** | Rectangles, rounded boxes, ellipses, lines, block arrows, cylinders that fit a preset within tolerance | Move, resize, recolour, type text in it |
| **B. Vector trace** | Hand-drawn or rough arrows, zigzag connectors, simple icons | Recolour, resize, ungroup (as `path` shapes) |
| **C. Raster cut-out** | Illustrations, photos, UI screenshots, complex icons | Move, resize, crop, replace |
| **D. Left in the background plate** | Faint decoration, textures, isometric line art, anything below a salience threshold | Not editable, stays as the backdrop |

Text is separate: it is always extracted as text (never traced), then painted out of the plate.

**Routing rule:** try A first and keep it if the fit error is below a threshold; else try B if the shape is simple
enough to trace in a small number of paths; else C if it is a coherent object; else D. This keeps slides editable
where it is cheap and honest about where it is not, and it is the main lever for balancing fidelity against editability.

### Modes (user-selectable, per deck and per slide)

- **Faithful**: text editable, everything else stays in the plate. What plain OCR gives. Lowest risk.
- **Balanced** (default): text, shapes (A), icons and figures cut out (C).
- **Max editable**: adds vector tracing (B), connectors, grouping and chart/table reconstruction.

"Re-convert this slide as…" re-runs only the affected stages (§9).

---

## 3. Architecture

```
Browser (this repo)                       Server
┌──────────────────────┐   REST + SSE     ┌────────────────────────────────────────────────┐
│ Uploader             │ ───────────────► │ API (FastAPI)  /v1/imports  /v1/jobs/{id}/events│
│  · digital pages:    │                  │ Postgres (jobs, decks, pages) · Redis queue      │
│    keep client path  │ ◄─────────────── │ Object storage (page images, plates, crops)      │
│  · flat pages: send  │  slide_ready      └───────────────┬────────────────────────────────┘
│    to server         │  (Deck JSON)                      │ one task per page
│ Editor + Review mode │                  ┌────────────────▼───────────────────────────────┐
│ Compare / Re-convert │                  │ Workers: CPU pool + GPU pool (model server)      │
└──────────────────────┘                  │ ingest → preprocess → detect → route → rebuild   │
                                          │        → inpaint → assemble → verify             │
                                          └────────────────────────────────────────────────┘
External (behind provider interfaces): vision-capable LLM, optional cloud OCR, optional image upscaler
```

- **Hybrid by page**: pages with a text layer stay on the client path, which is free and fast. Only flat pages go to
  the server. A mixed PDF produces one deck from both paths. (Today the client only discovers that a page is flat
  after fully rendering it; routing needs a cheap per-page text-layer check first. See §7.2.)
- **Same contract**: the server returns the same `Deck` and import report, and emits the same progress events
  (`lib/import/types.ts`). `importFile` gains one branch and the same signature. The uploader gains an option for
  scanned pages and a mode selector (§7.2), but the rest of the import flow is unchanged.
- **Per-page tasks** run in parallel. Each finished slide is sent with a `slide_ready` event, so the editor opens
  slide 1 while slide 14 is still processing.
- **Everything is cached** by content hash of the page image + settings + model versions, so re-converting a slide
  or re-uploading the same file is cheap.

Stack assumptions (change if the Jarvis backend dictates otherwise): Python 3.11, FastAPI, Arq or Celery with Redis,
PyTorch and ONNX Runtime for models, OpenCV and scikit-image for classical vision, S3-compatible storage,
Docker with GPU workers (a single mid-range inference GPU to start).

---

## 4. Pipeline stages

### Stage 0: Ingest
- **Take the embedded image, do not re-render it.** For a flat PDF, extract the page's image object at native
  resolution and apply its soft mask. For the example file that is the exact 1376×768 source, so there is no extra
  resampling blur.
- If the page has several images (e.g. a scan split into tiles), composite them in page order.
- Normalise colour space, orientation and DPI metadata. Reject encrypted files, enforce size and page limits.
- Store the original image as an asset and set `slide.sourceImageId` (needed for compare, revert and the verify loop).

### Stage 1: Preprocess
- Deskew and perspective-correct (only for camera scans; digital-born images skip this).
- Estimate the background: large-scale colour/texture model (e.g. heavy median blur at low resolution), flatness
  score. This decides whether text removal can use a flat fill or needs real inpainting.
- Optional **super-resolution** (2×) for pages below ~100 ppi equivalent. A/B test it in Phase 0: it can help OCR
  on small text and can hurt by inventing glyph shapes. Keep it only if CER improves on the gold set.

### Stage 2: Detection (run in parallel, merge in Stage 3)

**2a. Text detection and recognition**
- Candidate: PaddleOCR (text detection + recognition). Fallbacks: docTR, Tesseract (CPU, weak on stylised type),
  a cloud OCR provider behind the same interface.
- Output per line: polygon, text, per-character confidence, language, orientation.
- Run a second pass on low-confidence lines with a crop upscaled ×2–3.
- **Do not autocorrect.** Output exactly what is drawn. A separate, optional "possible typo" check can flag words
  for the user (a nice product feature for the example deck); it must never change text silently.

**2b. Layout detection**
- A detector for slide classes: `title, subtitle, body, list, caption, code, table, chart, figure, icon, logo,
  screenshot, shape, arrow, footer, page-number, decoration`.
- Start from a document-layout model, then **fine-tune on slide-like data** (§8). Off-the-shelf models are trained
  on papers and forms. Candidate licences must be reviewed: some YOLO-derived code is AGPL and would affect a
  closed service; evaluate Apache-licensed alternatives.

**2c. Shape and line candidates (classical vision)**
- Colour-quantise (k-means in Lab) → connected components → contour approximation → fit tests against presets
  (rect, rounded rect, ellipse, triangle, diamond, chevron, cylinder, arrow). Fit score = IoU of the fitted shape
  with the component mask. This must tolerate **rough, hand-drawn edges** like the salmon boxes on slide 2.
- Lines and connectors: Canny/LSD segments + skeletonisation of thin strokes; classify dashed vs solid by run-length
  of the stroke; detect arrowheads by local width profile at stroke endpoints.
- Frame/table grids: long horizontal/vertical segments that intersect into cells.

**2d. Segmentation for cut-outs**
- A promptable segmentation model (SAM-class) seeded with detected figure/icon boxes gives clean masks; a
  background-removal model is the cheaper fallback. Output: RGBA crop per figure.
- Close-to-rectangular items (UI screenshots) skip matting and keep a plain crop.

**2e. Vision-LLM pass (per slide, structured output)**
- Input: the slide image + a compact JSON of everything found so far (ids, boxes, text, shape guesses) + the
  detection overlay image.
- It returns **edits and labels only**, validated against a schema, never new content: text-box merge/split,
  roles (title/caption/…), reading order, "these items form a card/group", "this shape is a node and these
  lines are its connectors", "this figure is a chart, here are series/categories/values", "this is decorative".
- Edits are applied only if sanity checks pass (no text lost or added, boxes stay inside the slide). On failure,
  keep the heuristic result. Switchable off for cost or privacy.

### Stage 3: Merge and decide
- Reconcile overlapping detections with priority rules (text beats shape beats figure for the same pixels), then
  apply the routing rule from §2 to each region. Record the decision and fit score in `provenance`.
- **Decorative filter:** text that is faint, low-contrast, clipped by other objects or inside an illustration
  (the code snippets behind the globe on slide 1) is classed as decoration and left in the plate. Rule: OCR
  confidence × contrast × not-occluded; threshold tuned on the gold set.
- **Text inside pictures is not extracted:** if a text line lies inside a `screenshot`/`figure` region (the dashboard
  mock-up on slide 3, the map controls on slide 6, the API list on slide 12), it stays part of that picture. The same
  applies to text too small to be reliable (roughly under 6 px x-height in the source image); report the count.
- **Repeated marks across slides:** an element whose crop appears at the same position on several slides (the
  footer brand mark on all 14 pages, page numbers, watermarks) is classed `footer`/`logo`. By default it is left in
  the background, not turned into a text box on every slide. A per-deck setting can extract it as a movable logo.

### Stage 4: Rebuild text
- **Grouping:** lines → paragraphs (gap, indent and alignment heuristics) → text boxes (XY-cut, shared alignment axis).
  Bullets: leading glyph + hanging indent → `Bullet` with `level`. Text inside a detected shape is merged into that
  shape's own paragraphs, so a box and its label move together.
- **Size:** from glyph geometry (x-height/cap-height) converted by the page scale to pt in our 960-wide space.
- **Colour:** two-colour k-means over the glyph mask; text colour is the cluster far from the local background.
  Syntax-highlighted code gets one run per colour cluster along the line.
- **Weight/italic/family:** a font classifier that embeds a rendered crop and retrieves the nearest of a few hundred
  web-loadable fonts (Google Fonts), with a monospace detector for code. Keep the matched family only if its
  rendered width is within ±3% of the observed width; otherwise adjust letter-spacing slightly rather than
  letting the line re-wrap.
- **Per-run styling:** family, weight and colour are decided per run, not per line: a bold lead-in followed by regular
  text (slides 9, 13), monospace terms inside a proportional sentence (slide 6), keyword colours in code.
- **Links:** URLs and `[bit.ly/…]` strings are detected and stored as `Run.link` (the user can remove them).
- **Alignment:** left/centre/right inferred from the clustering of line starts, centres and ends within a block.
- **Typography check:** fit each text box so that, rendered by our renderer, line breaks match the source
  (verified in Stage 8).

### Stage 5: Rebuild shapes, connectors and figures
- **Shapes (A):** preset + fill colour (median of the interior after text removal) + stroke colour/width/dash.
  Add presets `cylinder`, `hexagon`, `cloud`, `ring`, `block-arrow-up/down/left` (diagonal arrows use rotation)
  and a connector element (§5). Soft drop shadows are estimated from the pixels just outside a card's edge and
  stored as an optional `shadow`; if the user turns shadows off, they are simply not drawn.
- **Connectors:** polyline path with optional arrowheads and dash style; endpoints snapped to the nearest shape
  edge when within tolerance and stored as `from/to` element ids so they follow when a box moves.
- **Vector trace (B):** colour-quantised tracing (VTracer or potrace-style) to a small number of `path` shapes.
  Reject a trace that exceeds a path-count or error budget and fall back to C.
- **Figures (C):** RGBA crops stored as assets; z-order from occlusion analysis (what overlaps what).
- **Design clean-up:** snap near-equal edges, widths and gaps within ~2 px, equalise sizes of repeated items
  (the four pill labels, the stacked bars). Without this, reconstructed slides look slightly "wobbly".

### Stage 6: Text and object removal (layer separation)
- Peel back-to-front: text first, then shapes and figures that became elements, leaving the background.
- **Mask from glyph pixels**, not from the OCR rectangle: threshold inside each text polygon, dilate 2–4 px. That
  avoids wiping out a shape or texture that merely sits under the box.
- **Fill method by background type:**
  - flat or gradient (flatness score high): analytic fill, no model;
  - textured (the paper grain here), photo, complex art: an inpainting model (LaMa-class, ONNX on GPU, OpenCV
    Telea as the CPU fallback);
  - shapes whose fill is known: fill with the shape colour, since the shape element will redraw it.
- Text that crosses decorative line art (the title over the wireframe on slide 14) is the hard case for flat fills:
  use the inpainting model there and check it in the verify loop.
- Result: one clean **background plate** per slide, saved as an asset and set as `slide.background`.
- Known weak spot (also true of today's browser importer): erasing over gradients/photos leaves visible patches.
  The inpainting model plus the verify loop (Stage 8) is the fix.

### Stage 7: Charts and tables from images
- **Tables:** ruled cells from line detection, borderless ones from text-column alignment → `TableElement`.
- **Charts:** classify type; read axis tick labels (already OCR'd) to calibrate pixel→value; measure bar
  heights/segment lengths/point positions; cross-check against any data labels in the picture (e.g. "4.5s", "0.7s").
  Output a `ChartSpec` with a confidence score. The vision LLM provides a second, independent reading.
  **If the two disagree by more than a tolerance, or confidence is under ~0.6, do not guess:** rebuild the chart as
  plain shapes + text (route A) and offer "Convert to chart…" in the editor with the extracted numbers pre-filled.
- Stylised infographic bars (slide 4's two-colour stacked bar) are an expected hard case; the fallback is the
  shapes route, which is still editable.

### Stage 8: Assemble and verify (self-correcting loop)
1. Build the `Deck` slide: theme inferred from dominant palette and fonts; elements in z-order; groups for cards;
   `provenance.source` (`ocr` | `vision`) and `confidence` on everything; `approximated` where applicable.
2. **Render with our own renderer** in headless Chromium (the same `SlideView` used by the editor), at the source
   resolution.
3. **Compare to the source image:** SSIM / perceptual distance per region, plus a text-pixel residual (are there
   dark glyph pixels in the render that the source does not have, or vice versa?).
4. For any region over a threshold: re-handle it. Typical fixes, in order: re-run OCR on that crop; swap the
   shape route (A→B→C); fall back to leaving the region in the plate (D). Maximum two passes per slide to bound cost.
5. Store the final diff map; it powers the "Compare with original" slider and Review highlights in the editor.

**Deck-level pass (after all slides finish):** cluster text styles across slides. Titles that differ by a few
percent in size become one size, and the dominant heading and body families become `theme.fonts`, with a
"Unify fonts" action offered where slides disagree. Repeated positions (title, footer) are recorded as layout
hints, which later feed real slide layouts.

---

## 5. Data model changes (frontend + backend, agreed first)

Small, backwards-compatible additions to `lib/deck/schema.ts` (and the generated Pydantic models):

| Addition | Why |
|---|---|
| `PRESET_SHAPES += cylinder, hexagon, cloud, ring, block-arrow-up/down/left` | Diagrams like slides 2, 3, 9, 13 |
| `ShapeElement.shadow?` (offset, blur, colour) | Card shadows (slides 7, 9, 11); exporter maps it to PowerPoint shadow |
| `ConnectorElement { points, arrowStart, arrowEnd, stroke, from?, to? }` | Arrows and lines that stay attached to boxes |
| `Slide.sourceImageId` (asset id) | Compare slider, revert-to-original, verify loop |
| `provenance.route: "shape" \| "trace" \| "cutout" \| "plate"` and `provenance.fitError` | Review mode, per-slide re-convert, metrics |
| `ShapeElement.paragraphs` already exists | Used for text inside boxes (no change) |
| `Slide.warnings[]` (optional) | Per-slide notes such as "2 regions left as picture" |

The PPTX exporter needs to handle connectors and the new presets (connectors → PowerPoint connector shapes with
arrowheads; new presets → closest built-in preset or custom geometry). Export already flattens groups and rasterises
anything it cannot express natively.

---

## 6. API contract (extends §7 of the main plan)

| Method & path | Purpose |
|---|---|
| `POST /v1/imports` | `{filename, size, mime, options:{mode, languages, llmRefine, upscale}}` → `{importId, uploadUrl}` |
| `POST /v1/imports/{id}/start` | Optionally `{pages:[3,4,5]}` to process only the flat pages → `{jobId}` |
| `GET /v1/jobs/{id}/events` (SSE) | `{stage, page, of, pct}`, `slide_ready {slide, assets}`, `warning`, `done`, `error` |
| `POST /v1/decks/{id}/slides/{sid}/reconvert` | `{mode, regions?: Box[], stages?: [...]}` → job; re-runs from cached intermediates |
| `GET /v1/decks/{id}/slides/{sid}/diff` | Verify-loop diff map for the compare/review UI |

All mutating calls carry the existing CSRF header. Rate-limit per user. Idempotent by content hash.

---

## 7. Frontend work (this repo)

1. **Fix the misleading import report first** (ships in Phase 0, independent of the server): a single deck-level
   message such as "0 of 14 slides have editable text, this PDF contains only images", no repeated per-page
   warnings, and no "everything below is editable" line when nothing is.
2. `lib/import/server.ts`: same `importFile` signature, uploads, follows SSE, assembles the `Deck` as slides arrive
   (reusing `lib/api/sse.ts` and `client.ts`). `importFile` routes flat pages to it; the uploader shows an option
   ("Convert scanned pages with AI", with the privacy note) and a mode selector. Two prerequisites: a cheap
   per-page text-layer check (`getTextContent` without rendering) so flat pages can be identified before upload, and
   page-order assembly of client and server slides into one deck with a shared slide size.
3. Streaming import: open the editor on the first `slide_ready`; mark pending slides with a spinner thumbnail.
4. **Compare with original** (slider/overlay using `sourceImage`), **Re-convert slide** menu (mode + "only this
   region"), **Revert region to original pixels**, a **Convert to chart** action, and typo flags in Review mode.
5. Renderer/editor support for the new connector element and presets (select, move endpoints, arrowheads).
6. Exporter updates for connectors and presets (§5).

---

## 8. Data and evaluation (do this first; it drives every decision)

### 8.1 Free labelled data from what we already built
We have an importer that turns real PPTX into exact `Deck` JSON and a renderer that draws a `Deck`. So:
**PPTX → import → Deck JSON (ground truth) → render to PNG → degrade → training/eval pair.**
Degradations: downsample to 72–150 ppi, JPEG artefacts, blur, paper/grain textures, slight colour shifts, plus a
"flat illustrated" style applied to shapes (rough edges, soft shadows) to mimic AI-generated slides.
This gives exact boxes, text, fonts, sizes, colours and shapes for thousands of slides at no labelling cost.

### 8.2 Gold set
- ~50 real flattened slides including all 14 pages of this PDF (with the owner's permission), hand-annotated: text
  lines, shapes, connectors, figures, groups, decorative regions. Start with slides 1, 2, 4, 6, 8 and 13, which
  between them cover the cover, diagram, chart, code/screenshot, table and hub cases. Split in half: tune on one half, report on the other.
- Annotate with our own editor (a "draw the correct Deck" mode) so the annotations are already in the target format.

### 8.3 Metrics (all computed in CI on the gold + synthetic sets)
| Metric | Target |
|---|---|
| Text character error rate, titles and body | ≤ 2% (target) |
| Text-box IoU vs ground truth | ≥ 0.85 mean (target) |
| Text-pixel coverage (glyph pixels explained by text elements) | ≥ 95% (target) |
| Shape detection F1 (type + box), connector F1 | ≥ 0.8 / ≥ 0.7 (target) |
| Re-render SSIM vs source | ≥ 0.90 (target) |
| Visible inpainting artefacts (blind review of 100 crops) | ≤ 10% of slides (target) |
| Chart value error (when a chart is produced) | ≤ 5% MAPE (target) |
| Latency per page, p50 / p95, GPU | ≤ 20 s / ≤ 60 s (target) |
| Cost per page | tracked from Phase 1; budget set after the first measurements |

Also track **editability** (share of the slide area that is editable elements instead of plate) and **how often users
revert or re-convert a slide**, since those show what automated metrics miss.

---

## 9. Phases

| Phase | Scope | Exit criteria | Est. |
|---|---|---|---|
| **0. Baseline, data, spikes** | Report fix (§7.1); eval harness; synthetic data generator from PPTX; gold set started; spikes: OCR engines, layout models, inpainting, super-resolution, vision LLM, **licence review** of every candidate | Reproducible numbers for the example PDF; engine choices written down | 2 wks |
| **1. Server skeleton + text** | FastAPI, queue, storage, SSE; Stage 0–1, OCR, text grouping/style, glyph-mask removal with flat fill + LaMa, assemble → **Faithful mode**; frontend `server.ts`, streaming open, compare slider | Example PDF: titles/body/captions editable, CER target met on those; plates clean on flat areas | 3–4 wks |
| **2. Shapes, figures, layering** | Layout detector (fine-tuned on synthetic + gold), shape fitting incl. rough edges, cut-outs with alpha, routing, z-order, design clean-up, theme inference; new presets | Shape F1 target on gold; pill labels and cards from slides 1–2 are shapes with text inside | 4 wks |
| **3. Diagrams** | Connectors with arrowheads and attachment, containers/cards grouping, vision-LLM structure pass, connector element in schema/renderer/exporter | Slide 2 and 3 diagrams: boxes, arrows and cylinders editable and attached | 3–4 wks |
| **4. Charts, tables, code** | Table reconstruction, chart extraction with calibration + cross-check + shapes fallback, "Convert to chart", code block handling | Chart MAPE target; slide 4's bars editable (as chart or shapes) | 3 wks |
| **5. Verify loop + controls** | Render-and-compare self-correction, diff map, Re-convert UI (mode / region), typo flags, caching, cost controls and quotas | Verify loop improves SSIM on gold; no slide worse than Faithful mode | 2–3 wks |
| **6. Hardening and scale** | Fine-tuning rounds, multilingual OCR, security review, autoscaling, monitoring, load tests, on-prem/private-cloud option | Meets latency/cost targets under load | ongoing |

Estimates assume one to two engineers focusing on this, with ML infrastructure available. Phases 1 (backend) and the
frontend items in §7 run in parallel once Phase 0 fixes the contract. A realistic first useful release is the end of
Phase 1 (editable text over a clean plate); the "Codia-like" result for diagrams arrives with Phases 2–3.

---

## 10. Security, privacy and operations

- **Uploads:** max size/pages; magic-byte checks; decompression-bomb limits on PDF streams and images; no arbitrary
  code paths; reject encrypted files.
- **Sandboxing:** parsers and model workers run unprivileged, no network except the model/LLM endpoints they need,
  with CPU/memory/time limits.
- **Third-party AI:** the vision-LLM and any cloud OCR sit behind provider interfaces. A per-user/org setting
  "Don't send my files to third-party AI" disables them and uses the open-source local path (with the quality drop
  reported honestly in the UI).
- **Retention:** page images, plates, intermediates and diffs are deleted after the retention window; failing pages
  kept for debugging only with consent.
- **Licences:** record licence and weight terms for every model and dataset (commercial use, AGPL/GPL copyleft,
  attribution). Block a model from production until reviewed.
- **Content safety:** moderation on any generated imagery (not used by this pipeline, but required for the AI
  enhancement features that share the infrastructure).
- **Observability:** per-stage timings, route statistics, verify-loop pass/fail, model version on every output so a
  regression can be traced; a dashboard of the Section 8.3 metrics for the nightly eval.

---

## 11. Risks and mitigations

| Risk | Mitigation |
|---|---|
| OCR errors on small/stylised text at 72 ppi | Super-resolution A/B, second pass on low-confidence crops, confidence shown in Review mode, "revert to original pixels" per region |
| Over-segmentation (every line its own box) or merging unrelated text | Grouping heuristics + LLM merge/split pass with schema validation; editor "merge text boxes" command |
| Inpainting artefacts on textured backgrounds | Model-based fill, verify loop, plate-faithful fallback, per-slide re-convert |
| Rough/hand-drawn shapes fit presets badly | Fit-error threshold, trace route, raster fallback; design clean-up snaps only when the error is small |
| LLM hallucinated structure or chart values | Schema validation, "edits only" contract, cross-check against measured geometry, never auto-apply low-confidence charts |
| Typos in the source are reproduced | Verbatim by default; optional typo flags for the user to accept; never silent correction |
| Cost and latency on GPU | Classify pages first (only flat pages go to the server), batch inference, cache by content hash, CPU fallbacks, per-plan quotas |
| Model licences incompatible with a closed service | Licence review in Phase 0; prefer permissive models; keep every model behind an interface |
| Editor can't represent what the pipeline finds (connectors, cylinders) | Schema additions agreed in Phase 0 and shipped with Phase 2–3 |
| Reconstructed slides look slightly off even when "correct" | Design clean-up (snapping, equalising), render-and-compare, and "Faithful" mode as the safe baseline |

---

## 12. Decisions needed from you

1. **Hosting:** can the Jarvis backend host GPU workers, or do we run a separate service? What GPU budget exists?
2. **Privacy:** may page images go to a third-party vision model/OCR, or must everything stay on our own infrastructure?
3. **Target quality:** is "editable text and shapes, diagrams as best effort" acceptable for the first release, with
   full diagram/connector fidelity in a later phase?
4. **Data:** can we use real customer-style flattened slides (this PDF and others) for the gold set and model tuning?
5. **Priority:** ship Phase 1 (editable text over a clean plate) as soon as it's ready, or hold for shapes first?

---

## 13. First two weeks, concretely

1. Ship the import-report fix (§7.1) in the existing browser importer.
2. Build the eval harness: image + `Deck` JSON in, metrics out; wire the synthetic generator (PPTX → Deck → PNG → degrade).
3. Extract the 14 source images from the example PDF at native resolution; hand-annotate slides 1, 2, 4, 6, 8 and 13 first.
4. Run the OCR, layout-detection, inpainting and vision-LLM spikes on those slides and the synthetic set; fill a
   comparison table (accuracy, speed, memory, licence).
5. Agree the schema additions (§5) and the API contract (§6) with the backend owner.
