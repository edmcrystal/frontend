import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { importPptx } from "./pptx";
import type { Element, Slide } from "@/lib/deck/schema";

const fixture = (name: string) => readFileSync(fileURLToPath(new URL(`./__fixtures__/${name}`, import.meta.url)));

const texts = (els: Element[]): string[] =>
  els.flatMap((e) =>
    e.type === "text" || (e.type === "shape" && e.paragraphs)
      ? [(e.type === "text" ? e.paragraphs : e.paragraphs!).map((p) => p.runs.map((r) => r.text).join("")).join("|")]
      : e.type === "group"
        ? texts(e.children)
        : [],
  );
const own = (s: Slide) => s.elements.filter((e) => !e.locked);

describe("importPptx (python-pptx fixture)", async () => {
  const progress: number[] = [];
  const { deck, report } = await importPptx(fixture("sample.pptx"), "sample.pptx", { onProgress: (p) => p.stage === "parsing" && progress.push(p.current) });

  if (process.env.DUMP) console.log(JSON.stringify({ deck: { ...deck, assets: Object.keys(deck.assets) }, report }, null, 1));

  it("reads size, slide order, title, theme and progress", () => {
    expect(deck.size).toEqual({ width: 959.98, height: 540 });
    expect(deck.slides).toHaveLength(5);
    expect(progress).toEqual([1, 2, 3, 4, 5]);
    expect(deck.title).toBe("Import Test Deck");
    expect(deck.theme.fonts).toEqual({ heading: "Calibri", body: "Calibri" });
    expect(deck.theme.colors.accent1).toBe("#4F81BD");
    expect(deck.source).toEqual({ kind: "pptx", fileId: "sample.pptx", pageCount: 5 });
  });

  it("inherits placeholder position and master text styles", () => {
    const [title, subtitle] = own(deck.slides[0]);
    expect(title.type === "text" && title.role).toBe("title");
    expect(title.frame.w).toBeGreaterThan(400);
    expect(title.type === "text" && title.paragraphs[0].runs[0]).toMatchObject({ text: "Import Test Deck", size: 44, font: "Calibri", color: "#000000" });
    expect(title.type === "text" && title.paragraphs[0].align).toBe("center");
    expect(subtitle.type === "text" && subtitle.paragraphs[0].bullet).toBeUndefined();
    expect(deck.slides[0].notes).toBe("Speaker notes for the title slide.");
  });

  it("imports bullets, levels and numbering", () => {
    const [, body, numbered] = own(deck.slides[1]);
    expect(body.type).toBe("text");
    if (body.type !== "text" || numbered.type !== "text") return;
    expect(body.paragraphs.map((p) => [p.level, p.bullet?.type === "char" ? p.bullet.char : null])).toEqual([
      [0, "•"],
      [1, "–"],
      [1, "–"],
      [0, "•"],
    ]);
    expect(body.paragraphs[3].runs[0]).toMatchObject({ bold: true, color: "#C02020", size: 32 });
    expect(body.paragraphs[1].runs[0].size).toBe(28);
    expect(numbered.paragraphs.map((p) => p.bullet)).toEqual(Array(3).fill({ type: "number", format: "arabic-period", startAt: 1 }));
    expect(numbered.autofit).toBe("resize");
  });

  it("imports pictures, merged tables and rotated shapes", () => {
    const els = own(deck.slides[2]);
    const pic = els.find((e) => e.type === "image");
    expect(pic?.type === "image" && pic.alt).toBe("Orange block");
    expect(pic?.type === "image" && deck.assets[pic.assetId]).toMatchObject({ mime: "image/png", width: 40, height: 30 });
    const table = els.find((e) => e.type === "table");
    if (table?.type !== "table") throw new Error("no table");
    expect(table.columns).toHaveLength(3);
    expect(table.rows[0].cells).toHaveLength(2);
    expect(table.rows[0].cells[0].colSpan).toBe(2);
    expect(table.rows[0].cells[0].paragraphs[0].runs[0]).toMatchObject({ text: "Merged header", bold: true, color: "#FFFFFF" });
    const rotated = els.find((e) => e.name?.startsWith("Rounded"));
    expect(rotated).toMatchObject({ type: "shape", geometry: { preset: "round-rect" }, fill: { type: "solid", color: "#10B981" } });
    expect(rotated?.frame.rotation).toBe(30);
    const oval = els.find((e) => e.type === "shape" && "preset" in e.geometry && e.geometry.preset === "ellipse");
    expect(oval?.type === "shape" && oval.stroke).toEqual({ color: "#000000", width: 3, dash: "solid" });
  });

  it("imports native charts with data", () => {
    const charts = own(deck.slides[3]).filter((e) => e.type === "chart");
    expect(charts).toHaveLength(2);
    const [col, pie] = charts;
    expect(col.type === "chart" && col.spec).toMatchObject({
      type: "column",
      categories: ["Q1", "Q2", "Q3", "Q4"],
      series: [
        { name: "Revenue", values: [1.2, 1.8, 2.1, 2.9] },
        { name: "Target", values: [1.5, 1.7, 2.2, 2.6] },
      ],
      legend: "bottom",
    });
    expect(pie.type === "chart" && pie.spec).toMatchObject({ type: "pie", categories: ["A", "B", "C"], series: [{ name: "Share", values: [50, 30, 20] }] });
  });

  it("imports groups with children relative to the group", () => {
    const group = own(deck.slides[4]).find((e) => e.type === "group");
    if (group?.type !== "group") throw new Error("no group");
    expect(group.frame).toMatchObject({ x: 144, y: 144, w: 432, h: 216 });
    expect(group.children.map((c) => c.frame.x)).toEqual([0, 14.4, 288]);
    expect(texts(group.children)).toEqual(["Grouped caption"]);
    const right = own(deck.slides[4]).find((e) => e.type === "text");
    expect(right?.type === "text" && right.paragraphs[0]).toMatchObject({ align: "right", runs: [{ size: 28, italic: true }] });
  });

  it("reports what it did", () => {
    expect(report.counts).toMatchObject({ slide: 5, chart: 2, table: 1, image: 1, group: 1 });
    expect(report.warnings.some((w) => w.message.includes("table styles"))).toBe(true);
  });
});
