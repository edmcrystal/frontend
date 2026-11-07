"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Draft } from "immer";
import type { ChartSpec, Deck, Element, Fill, Paragraph, PresetShape, Slide, TableElement } from "@/lib/deck/schema";
import { PRESET_SHAPES } from "@/lib/deck/schema";
import { useEditor } from "@/lib/deck/store";
import { locate, setSlideBackground, updateElement } from "@/lib/deck/commands";
import { imageFileToAsset } from "@/lib/deck/factories";
import { addColumn, addRow as addTableRow, layoutCells, removeLastColumn, removeLastRow } from "@/lib/deck/table";
import { round2 } from "@/lib/deck/geometry";
import { LOW_CONFIDENCE } from "./renderers/ElementView";
import ui from "./ui.module.css";

// ---------- Small controls ----------

/** Number input that keeps what you type until it parses, then commits. */
function NumberField({ label, value, onChange, step = 1, min, max, title }: { label: string; value: number; onChange: (n: number) => void; step?: number; min?: number; max?: number; title?: string }) {
  const [text, setText] = useState(String(round2(value)));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(String(round2(value)));
  }, [value]);
  return (
    <label className={ui.field} title={title ?? label}>
      <span>{label}</span>
      <input
        className={ui.input}
        type="number"
        step={step}
        min={min}
        max={max}
        value={text}
        aria-label={title ?? label}
        onFocus={() => (focused.current = true)}
        onBlur={() => {
          focused.current = false;
          setText(String(round2(value)));
        }}
        onChange={(e) => {
          setText(e.target.value);
          const n = parseFloat(e.target.value);
          if (Number.isFinite(n)) onChange(min !== undefined ? Math.max(min, max !== undefined ? Math.min(max, n) : n) : n);
        }}
      />
    </label>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={ui.section}>
      <h3 className={ui.sectionTitle}>{title}</h3>
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={ui.row}>
      <label>{label}</label>
      {children}
    </div>
  );
}

function FillControl({ fill, onChange, allowNone = true }: { fill: Fill | undefined; onChange: (f: Fill) => void; allowNone?: boolean }) {
  const solid = fill?.type === "solid" ? fill.color : fill?.type === "linear-gradient" ? fill.stops[0].color : "#FFFFFF";
  const isNone = !fill || fill.type === "none";
  return (
    <div className={ui.row} style={{ gap: 6 }}>
      <input className={ui.color} type="color" aria-label="Fill color" value={solid.slice(0, 7)} onChange={(e) => onChange({ type: "solid", color: e.target.value.toUpperCase() })} />
      <span className={ui.note}>{isNone ? "None" : fill?.type === "solid" ? fill.color : fill?.type}</span>
      {allowNone && !isNone && (
        <button type="button" className={ui.btn} onClick={() => onChange({ type: "none" })}>
          No fill
        </button>
      )}
    </div>
  );
}

// ---------- Panels ----------

type Update = (patch: Partial<Element>, key?: string) => void;
type Mutate = (fn: (el: Draft<Element>) => void, key?: string) => void;

function PositionPanel({ el, update }: { el: Element; update: Update }) {
  const f = el.frame;
  const set = (k: keyof typeof f) => (n: number) => update({ frame: { ...f, [k]: k === "w" || k === "h" ? Math.max(0, n) : n } }, `frame-${k}`);
  return (
    <Section title="Position & size">
      <div className={ui.grid2}>
        <NumberField label="X" value={f.x} onChange={set("x")} />
        <NumberField label="Y" value={f.y} onChange={set("y")} />
        <NumberField label="W" title="Width" value={f.w} onChange={set("w")} min={0} />
        <NumberField label="H" title="Height" value={f.h} onChange={set("h")} min={0} />
        <NumberField label="∠" title="Rotation (degrees)" value={f.rotation} onChange={set("rotation")} step={1} min={-360} max={360} />
      </div>
      <Row label="Opacity">
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          aria-label="Opacity"
          value={el.opacity ?? 1}
          onChange={(e) => update({ opacity: parseFloat(e.target.value) }, "opacity")}
          style={{ flex: 1 }}
        />
      </Row>
      <Row label="Lock">
        <input type="checkbox" checked={!!el.locked} onChange={(e) => update({ locked: e.target.checked || undefined })} aria-label="Lock position" />
      </Row>
    </Section>
  );
}

function ProvenancePanel({ el, update }: { el: Element; update: Update }) {
  const p = el.provenance;
  if (!p || p.source === "user") return null;
  const low = p.confidence !== undefined && p.confidence < LOW_CONFIDENCE;
  const source = { native: "file contents", ocr: "OCR", vision: "image recognition", "ai-generated": "AI", user: "you" }[p.source];
  return (
    <Section title="Import">
      <p className={ui.note}>
        Detected from {source}
        {p.confidence !== undefined ? ` · ${Math.round(p.confidence * 100)}% confidence` : ""}
        {p.approximated ? " · approximated" : ""}
      </p>
      {low && (
        <button type="button" className={ui.btn} onClick={() => update({ provenance: { ...p, confidence: 1 } })}>
          Mark as checked
        </button>
      )}
    </Section>
  );
}

function TextPanel({ el, update }: { el: Extract<Element, { type: "text" }>; update: Update }) {
  return (
    <Section title="Text box">
      <Row label="Fill">
        <FillControl fill={el.fill} onChange={(fill) => update({ fill } as Partial<Element>, "fill")} />
      </Row>
      <Row label="Vertical">
        <select className={ui.select} value={el.verticalAlign} onChange={(e) => update({ verticalAlign: e.target.value } as Partial<Element>)}>
          <option value="top">Top</option>
          <option value="middle">Middle</option>
          <option value="bottom">Bottom</option>
        </select>
      </Row>
      <p className={ui.note}>Double-click or press Enter to edit the text.</p>
    </Section>
  );
}

function ShapePanel({ el, update }: { el: Extract<Element, { type: "shape" }>; update: Update }) {
  const preset = "preset" in el.geometry ? el.geometry.preset : null;
  const stroke = el.stroke;
  return (
    <Section title="Shape">
      {preset && (
        <Row label="Type">
          <select className={ui.select} value={preset} onChange={(e) => update({ geometry: { preset: e.target.value as PresetShape } } as Partial<Element>)}>
            {PRESET_SHAPES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </Row>
      )}
      <Row label="Fill">
        <FillControl fill={el.fill} onChange={(fill) => update({ fill } as Partial<Element>, "fill")} />
      </Row>
      <Row label="Border">
        <input
          className={ui.color}
          type="color"
          aria-label="Border color"
          value={(stroke?.color ?? "#000000").slice(0, 7)}
          onChange={(e) => update({ stroke: { width: 1, dash: "solid", ...stroke, color: e.target.value.toUpperCase() } } as Partial<Element>, "stroke-color")}
        />
        <NumberField label="" title="Border width" value={stroke?.width ?? 0} min={0} max={50} onChange={(width) => update({ stroke: { color: "#000000", dash: "solid", ...stroke, width } } as Partial<Element>, "stroke-width")} />
      </Row>
      {stroke && (
        <Row label="Style">
          <select className={ui.select} value={stroke.dash} onChange={(e) => update({ stroke: { ...stroke, dash: e.target.value } } as Partial<Element>)}>
            <option value="solid">Solid</option>
            <option value="dash">Dashed</option>
            <option value="dot">Dotted</option>
            <option value="dash-dot">Dash-dot</option>
          </select>
          <button type="button" className={ui.btn} onClick={() => update({ stroke: undefined } as Partial<Element>)}>
            No border
          </button>
        </Row>
      )}
    </Section>
  );
}

function ImagePanel({ el, update, slideId }: { el: Extract<Element, { type: "image" }>; update: Update; slideId: string }) {
  const commit = useEditor((s) => s.commit);
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <Section title="Image">
      <Row label="Mask">
        <select className={ui.select} value={el.mask} onChange={(e) => update({ mask: e.target.value } as Partial<Element>)}>
          <option value="rect">None</option>
          <option value="rounded">Rounded</option>
          <option value="ellipse">Circle / ellipse</option>
        </select>
      </Row>
      <Row label="Alt text">
        <input className={ui.input} style={{ flex: 1 }} value={el.alt ?? ""} placeholder="Describe the image" onChange={(e) => update({ alt: e.target.value || undefined } as Partial<Element>, "alt")} />
      </Row>
      <button type="button" className={ui.btn} onClick={() => fileRef.current?.click()}>
        Replace image…
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          const asset = await imageFileToAsset(file);
          commit((d) => {
            d.assets[asset.id] = asset;
            updateElement(d, slideId, el.id, { assetId: asset.id, crop: undefined } as Partial<Element>);
          });
        }}
      />
    </Section>
  );
}

function cellText(ps: Paragraph[]) {
  return ps.map((p) => p.runs.map((r) => r.text).join("")).join("\n");
}

function TablePanel({ el, mutate }: { el: TableElement; mutate: Mutate }) {
  const setCell = (r: number, c: number, text: string) =>
    mutate((d) => {
      const t = d as Draft<TableElement>;
      const cell = t.rows[r].cells[c];
      const style = cell.paragraphs[0]?.runs[0] ?? t.rows[0].cells[0].paragraphs[0]?.runs[0];
      const align = cell.paragraphs[0]?.align ?? "center";
      cell.paragraphs = text.split("\n").map((line) => ({
        align,
        level: 0,
        runs: [{ ...(style ?? { font: "Arial", size: 14, color: "#000000" }), text: line }],
      }));
    }, `cell-${r}-${c}`);

  const addRow = () => mutate((d) => void ((d as Draft<TableElement>).frame.h += addTableRow(d as Draft<TableElement>)));
  const removeRow = () => mutate((d) => void ((d as Draft<TableElement>).frame.h -= removeLastRow(d as Draft<TableElement>)));
  const addCol = () => mutate((d) => void ((d as Draft<TableElement>).frame.w += addColumn(d as Draft<TableElement>)));
  const removeCol = () => mutate((d) => void ((d as Draft<TableElement>).frame.w -= removeLastColumn(d as Draft<TableElement>)));

  return (
    <Section title="Table cells">
      <div className={ui.dataGrid} style={{ gridTemplateColumns: `repeat(${el.columns.length}, minmax(56px, 1fr))` }}>
        {layoutCells(el).map((p) => (
          <input
            key={`${p.row}-${p.index}`}
            className={ui.input}
            aria-label={`Row ${p.row + 1} column ${p.col + 1}`}
            style={{ gridColumn: `${p.col + 1} / span ${p.colSpan}`, gridRow: `${p.row + 1} / span ${p.rowSpan}`, height: "auto", minHeight: 26 }}
            value={cellText(el.rows[p.row].cells[p.index].paragraphs)}
            onChange={(e) => setCell(p.row, p.index, e.target.value)}
          />
        ))}
      </div>
      <div className={ui.row} style={{ flexWrap: "wrap", gap: 4 }}>
        <button type="button" className={ui.btn} onClick={addRow}>+ Row</button>
        <button type="button" className={ui.btn} onClick={removeRow} disabled={el.rows.length <= 1}>− Row</button>
        <button type="button" className={ui.btn} onClick={addCol}>+ Column</button>
        <button type="button" className={ui.btn} onClick={removeCol} disabled={el.columns.length <= 1}>− Column</button>
      </div>
    </Section>
  );
}

function ChartPanel({ el, mutate, deck }: { el: Extract<Element, { type: "chart" }>; mutate: Mutate; deck: Deck }) {
  const spec = el.spec;
  const setSpec = (fn: (s: Draft<ChartSpec>) => void, key?: string) =>
    mutate((d) => fn((d as Draft<Extract<Element, { type: "chart" }>>).spec), key);
  const palette = [deck.theme.colors.accent1, deck.theme.colors.accent2, deck.theme.colors.accent3, deck.theme.colors.accent4, deck.theme.colors.accent5, deck.theme.colors.accent6];
  const pie = spec.type === "pie" || spec.type === "donut";
  return (
    <Section title="Chart">
      <Row label="Type">
        <select className={ui.select} value={spec.type} onChange={(e) => setSpec((s) => void (s.type = e.target.value as ChartSpec["type"]))}>
          {["column", "bar", "line", "area", "pie", "donut", "scatter"].map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </Row>
      <Row label="Title">
        <input className={ui.input} style={{ flex: 1 }} value={spec.title ?? ""} onChange={(e) => setSpec((s) => void (s.title = e.target.value || undefined), "title")} />
      </Row>
      <Row label="Legend">
        <select className={ui.select} value={spec.legend} onChange={(e) => setSpec((s) => void (s.legend = e.target.value as ChartSpec["legend"]))}>
          {["bottom", "top", "left", "right", "none"].map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </Row>
      <Row label="Labels">
        <input type="checkbox" aria-label="Data labels" checked={!!spec.dataLabels} onChange={(e) => setSpec((s) => void (s.dataLabels = e.target.checked))} />
        {!pie && (
          <>
            <span className={ui.note}>Stacked</span>
            <input type="checkbox" aria-label="Stacked" checked={!!spec.stacked} onChange={(e) => setSpec((s) => void (s.stacked = e.target.checked))} />
          </>
        )}
      </Row>
      <h3 className={ui.sectionTitle}>Data</h3>
      {pie && spec.series.length > 1 && <p className={ui.note}>Pie charts show the first series only.</p>}
      <div className={ui.dataGrid} style={{ gridTemplateColumns: `repeat(${spec.series.length + 1}, minmax(56px, 1fr))` }}>
        <span className={ui.note} style={{ alignSelf: "center" }}>Category</span>
        {spec.series.map((s, i) => (
          <div key={i} style={{ display: "flex", gap: 2, minWidth: 0 }}>
            <input className={ui.input} aria-label={`Series ${i + 1} name`} value={s.name} onChange={(e) => setSpec((sp) => void (sp.series[i].name = e.target.value), `series-name-${i}`)} />
            <input
              className={ui.color}
              type="color"
              aria-label={`Series ${i + 1} color`}
              style={{ width: 24, flex: "0 0 24px" }}
              value={(s.color ?? palette[i % palette.length]).slice(0, 7)}
              onChange={(e) => setSpec((sp) => void (sp.series[i].color = e.target.value.toUpperCase()), `series-color-${i}`)}
            />
          </div>
        ))}
        {spec.categories.map((cat, r) => (
          <CategoryRow key={r} r={r} cat={cat} spec={spec} setSpec={setSpec} />
        ))}
      </div>
      <div className={ui.row} style={{ flexWrap: "wrap", gap: 4 }}>
        <button type="button" className={ui.btn} onClick={() => setSpec((s) => { s.categories.push(`Item ${s.categories.length + 1}`); s.series.forEach((x) => x.values.push(0)); })}>+ Row</button>
        <button type="button" className={ui.btn} disabled={spec.categories.length <= 1} onClick={() => setSpec((s) => { s.categories.pop(); s.series.forEach((x) => x.values.pop()); })}>− Row</button>
        <button type="button" className={ui.btn} onClick={() => setSpec((s) => void s.series.push({ name: `Series ${s.series.length + 1}`, values: s.categories.map(() => 0) }))}>+ Series</button>
        <button type="button" className={ui.btn} disabled={spec.series.length <= 1} onClick={() => setSpec((s) => void s.series.pop())}>− Series</button>
      </div>
      <p className={ui.note}>Tip: paste rows copied from a spreadsheet into any cell.</p>
    </Section>
  );
}

function CategoryRow({ r, cat, spec, setSpec }: { r: number; cat: string; spec: ChartSpec; setSpec: (fn: (s: Draft<ChartSpec>) => void, key?: string) => void }) {
  /** Pasting tab-separated rows fills the grid from this cell down. */
  const onPaste = (e: React.ClipboardEvent, col: number) => {
    const text = e.clipboardData.getData("text/plain");
    if (!text.includes("\t") && !text.includes("\n")) return;
    e.preventDefault();
    const rows = text.trim().split(/\r?\n/).map((l) => l.split("\t"));
    setSpec((s) => {
      rows.forEach((cells, i) => {
        const ri = r + i;
        while (s.categories.length <= ri) {
          s.categories.push(`Item ${s.categories.length + 1}`);
          s.series.forEach((x) => x.values.push(0));
        }
        cells.forEach((v, j) => {
          const cj = col + j;
          if (cj === 0) s.categories[ri] = v.trim();
          else {
            while (s.series.length < cj) s.series.push({ name: `Series ${s.series.length + 1}`, values: s.categories.map(() => 0) });
            const n = parseFloat(v.replace(/[^0-9.+-eE]/g, ""));
            s.series[cj - 1].values[ri] = Number.isFinite(n) ? n : null;
          }
        });
      });
    });
  };
  return (
    <>
      <input className={ui.input} aria-label={`Category ${r + 1}`} value={cat} onPaste={(e) => onPaste(e, 0)} onChange={(e) => setSpec((s) => void (s.categories[r] = e.target.value), `cat-${r}`)} />
      {spec.series.map((s, i) => (
        <input
          key={i}
          className={ui.input}
          type="number"
          aria-label={`${s.name}, ${cat}`}
          value={s.values[r] ?? ""}
          onPaste={(e) => onPaste(e, i + 1)}
          onChange={(e) => {
            const n = parseFloat(e.target.value);
            setSpec((sp) => void (sp.series[i].values[r] = Number.isFinite(n) ? n : null), `val-${r}-${i}`);
          }}
        />
      ))}
    </>
  );
}

function SlidePanel({ deck, slide }: { deck: Deck; slide: Slide }) {
  const commit = useEditor((s) => s.commit);
  return (
    <div className={ui.panel}>
      <Section title="Slide">
        <Row label="Background">
          <FillControl fill={slide.background} allowNone={false} onChange={(fill) => commit((d) => setSlideBackground(d, slide.id, fill), { key: `bg-${slide.id}` })} />
        </Row>
        <button
          type="button"
          className={ui.btn}
          onClick={() => commit((d) => d.slides.forEach((s) => void (s.background = structuredClone(slide.background) as Draft<Fill>)))}
        >
          Apply background to all slides
        </button>
        {slide.layoutHint && <p className={ui.note}>Layout: {slide.layoutHint}</p>}
      </Section>
      <Section title="Deck">
        <Row label="Title">
          <input className={ui.input} style={{ flex: 1 }} value={deck.title} onChange={(e) => commit((d) => void (d.title = e.target.value), { key: "deck-title" })} />
        </Row>
        <p className={ui.note}>
          {deck.slides.length} slides · {deck.size.width}×{deck.size.height} pt
        </p>
      </Section>
      <Section title="Tips">
        <p className={ui.note}>
          Click to select, Shift-click or drag on empty space to select several. Double-click text to edit. Arrow keys nudge (Shift ×10), Alt while dragging turns off snapping.
        </p>
      </Section>
    </div>
  );
}

export function Inspector() {
  const deck = useEditor((s) => s.deck)!;
  const slideId = useEditor((s) => s.slideId)!;
  const selection = useEditor((s) => s.selection);
  const commit = useEditor((s) => s.commit);
  const slide = deck.slides.find((s) => s.id === slideId);
  if (!slide) return null;
  if (selection.length === 0) return <SlidePanel deck={deck} slide={slide} />;
  if (selection.length > 1)
    return (
      <div className={ui.panel}>
        <Section title={`${selection.length} items selected`}>
          <p className={ui.note}>Use Align in the toolbar to line them up, or Group (Ctrl+G) to move them as one.</p>
        </Section>
      </div>
    );

  const el = locate(slide.elements, selection[0])?.el;
  if (!el) return null;
  const update: Update = (patch, key) => commit((d) => updateElement(d, slideId, el.id, patch), key ? { key: `insp-${el.id}-${key}` } : undefined);
  const mutate: Mutate = (fn, key) =>
    commit(
      (d) => {
        const hit = locate(d.slides.find((s) => s.id === slideId)!.elements, el.id);
        if (hit) fn(hit.el);
      },
      key ? { key: `insp-${el.id}-${key}` } : undefined,
    );

  return (
    <div className={ui.panel}>
      <PositionPanel el={el} update={update} />
      {el.type === "text" && <TextPanel el={el} update={update} />}
      {el.type === "shape" && <ShapePanel el={el} update={update} />}
      {el.type === "image" && <ImagePanel el={el} update={update} slideId={slideId} />}
      {el.type === "table" && <TablePanel el={el} mutate={mutate} />}
      {el.type === "chart" && <ChartPanel el={el} mutate={mutate} deck={deck} />}
      {el.type === "icon" && (
        <Section title="Icon">
          <Row label="Color">
            <input className={ui.color} type="color" aria-label="Icon color" value={el.color.slice(0, 7)} onChange={(e) => update({ color: e.target.value.toUpperCase() } as Partial<Element>, "color")} />
          </Row>
        </Section>
      )}
      {el.type === "group" && (
        <Section title="Group">
          <p className={ui.note}>
            {el.children.length} items{el.infographic ? ` · infographic "${el.infographic.templateId}"` : ""}. Double-click text inside to edit it, or ungroup (Ctrl+Shift+G) to move items separately.
          </p>
        </Section>
      )}
      <ProvenancePanel el={el} update={update} />
    </div>
  );
}
