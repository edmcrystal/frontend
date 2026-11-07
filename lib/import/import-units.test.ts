import { describe, expect, it } from "vitest";
import { child, find, parseXml, relAttr, attr, decodeEntities } from "./xml";
import { applyModifiers, emuToPt, parseColorMap, resolveColor, type ColorContext } from "./color";
import { resolvePath, relsPathFor, imageSize } from "./pptx/package";
import { detectBullet, eraseBoxes, groupBlocks, groupLines, inkColor, mapFontName, ringColor, type TextItem } from "./pdf/layout";

describe("xml", () => {
  it("parses elements, attributes, entities, CDATA and comments", () => {
    const root = parseXml(`<?xml version="1.0"?><!-- c --><a:p xmlns:a="x" r:id="rId1" id="7"><a:t>A &amp; B &#x2022; &lt;3</a:t><a:br/><![CDATA[<raw>]]></a:p>`);
    expect(root.name).toBe("p");
    expect(root.qname).toBe("a:p");
    expect(child(root, "t")?.text).toBe("A & B • <3");
    expect(child(root, "br")).toBeTruthy();
    expect(root.text).toBe("<raw>");
    expect(attr(root, "id")).toBe("7");
    expect(relAttr(root, "id")).toBe("rId1");
    expect(find(root, "t")?.name).toBe("t");
  });

  it("handles '>' inside attribute values and rejects mismatched tags", () => {
    expect(parseXml(`<a v="1>2"/>`).attrs.v).toBe("1>2");
    expect(() => parseXml("<a><b></a>")).toThrow();
    expect(decodeEntities("&quot;&apos;&unknown;")).toBe(`"'&unknown;`);
  });
});

describe("units and colors", () => {
  const ctx: ColorContext = {
    scheme: { dk1: "#000000", lt1: "#FFFFFF", accent1: "#4472C4", dk2: "#44546A", lt2: "#E7E6E6" },
    map: parseColorMap(parseXml(`<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1"/>`)),
  };
  const color = (xml: string) => resolveColor(parseXml(xml), ctx);

  it("converts EMU to points", () => {
    expect(emuToPt(12700)).toBe(1);
    expect(emuToPt(914400)).toBe(72);
  });

  it("resolves scheme colors through the color map with lumMod/lumOff", () => {
    expect(color(`<a:solidFill><a:schemeClr val="tx1"/></a:solidFill>`)).toBe("#000000");
    expect(color(`<a:schemeClr val="bg1"><a:lumMod val="85000"/></a:schemeClr>`)).toBe("#D9D9D9");
    // "Accent 1, lighter 40%": lumMod 60% + lumOff 40%.
    expect(color(`<a:schemeClr val="accent1"><a:lumMod val="60000"/><a:lumOff val="40000"/></a:schemeClr>`)).toBe("#8FAADC");
    expect(color(`<a:srgbClr val="FF0000"><a:alpha val="50000"/></a:srgbClr>`)).toBe("#FF000080");
    expect(color(`<a:sysClr val="windowText" lastClr="111111"/>`)).toBe("#111111");
    expect(color(`<a:prstClr val="white"/>`)).toBe("#FFFFFF");
    expect(color(`<a:schemeClr val="nope"/>`)).toBeUndefined();
  });

  it("applies tint and shade", () => {
    const mod = (name: string, val: number) => parseXml(`<a:${name} val="${val}"/>`);
    expect(applyModifiers("#000000", [mod("tint", 50000)])).toBe("#808080");
    expect(applyModifiers("#FFFFFF", [mod("shade", 50000)])).toBe("#808080");
  });
});

describe("package paths", () => {
  it("resolves relationship targets", () => {
    expect(resolvePath("ppt/slides/slide1.xml", "../slideLayouts/slideLayout2.xml")).toBe("ppt/slideLayouts/slideLayout2.xml");
    expect(resolvePath("ppt/presentation.xml", "slides/slide1.xml")).toBe("ppt/slides/slide1.xml");
    expect(resolvePath("ppt/slides/slide1.xml", "/ppt/media/a.png")).toBe("ppt/media/a.png");
    expect(relsPathFor("ppt/slides/slide1.xml")).toBe("ppt/slides/_rels/slide1.xml.rels");
  });

  it("reads image sizes from headers", () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 40, 0, 0, 0, 30, 0]);
    expect(imageSize(png)).toEqual({ width: 40, height: 30 });
    expect(imageSize(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 10, 0, 20, 0, 0]))).toEqual({ width: 10, height: 20 });
  });
});

describe("pdf fonts and bullets", () => {
  it("maps PDF font names", () => {
    expect(mapFontName("ABCDEF+Calibri-BoldItalic")).toEqual({ family: "Calibri", bold: true, italic: true });
    expect(mapFontName("TimesNewRomanPSMT")).toEqual({ family: "Times New Roman", bold: false, italic: false });
    expect(mapFontName("Arial,Bold")).toEqual({ family: "Arial", bold: true, italic: false });
    expect(mapFontName("LiberationSans")).toEqual({ family: "Arial", bold: false, italic: false });
    expect(mapFontName("OpenSansCondensed-Light").family).toBe("Open Sans");
    expect(mapFontName("FancyDisplayFace-Semibold")).toEqual({ family: "Fancy Display Face", bold: true, italic: false });
  });

  it("detects bullet glyphs and list numbers", () => {
    expect(detectBullet("• First")).toEqual({ bullet: { type: "char", char: "•" }, rest: "First" });
    expect(detectBullet(" Item")?.bullet).toEqual({ type: "char", char: "•" });
    expect(detectBullet("3. Third")).toEqual({ bullet: { type: "number", format: "arabic-period", startAt: 3 }, rest: "Third" });
    expect(detectBullet("b) second")?.bullet).toEqual({ type: "number", format: "alpha-lower", startAt: 2 });
    expect(detectBullet("iv. four")?.bullet).toMatchObject({ format: "roman-lower" });
    expect(detectBullet("J. Smith")).toBeNull();
    expect(detectBullet("-5 degrees")).toBeNull();
    expect(detectBullet("3.5 million")).toBeNull();
  });
});

const item = (text: string, x: number, baseline: number, size = 20, extra: Partial<TextItem> = {}): TextItem => ({
  text,
  x,
  baseline,
  width: text.length * size * 0.5,
  size,
  ascent: 0.8,
  font: "Arial",
  bold: false,
  italic: false,
  color: "#000000",
  ...extra,
});

describe("pdf text layout", () => {
  it("joins items on a baseline into one line with spaces", () => {
    const lines = groupLines([item("World", 80, 100), item("Hello", 20, 100.5)]);
    expect(lines).toHaveLength(1);
    const [block] = groupBlocks(lines, 960);
    expect(block.paragraphs[0].runs.map((r) => r.text).join("")).toBe("Hello World");
  });

  it("keeps styled runs separate", () => {
    const [block] = groupBlocks(groupLines([item("Revenue ", 20, 100), item("38%", 100, 100, 20, { bold: true, color: "#2563EB" })]), 960);
    expect(block.paragraphs[0].runs).toEqual([
      { text: "Revenue ", font: "Arial", size: 20, color: "#000000" },
      { text: "38%", font: "Arial", size: 20, color: "#2563EB", bold: true },
    ]);
  });

  it("builds a bulleted list with levels in one box, and separates a title and a second column", () => {
    const items = [
      item("Agenda", 60, 60, 40),
      item("•", 60, 140),
      item("First point", 85, 140),
      item("–", 90, 168),
      item("Sub point", 115, 168),
      item("•", 60, 196),
      item("Second point", 85, 196),
      item("Side note", 600, 140),
    ];
    const blocks = groupBlocks(groupLines(items), 960);
    expect(blocks).toHaveLength(3);
    const list = blocks.find((b) => b.paragraphs.length === 3)!;
    expect(list.paragraphs.map((p) => [p.level, p.bullet && "char" in p.bullet ? p.bullet.char : null, p.runs.map((r) => r.text).join("")])).toEqual([
      [0, "•", "First point"],
      [1, "–", "Sub point"],
      [0, "•", "Second point"],
    ]);
    expect(blocks.find((b) => b.x === 600)?.paragraphs[0].runs[0].text).toBe("Side note");
  });

  it("re-joins wrapped lines of one paragraph and detects centered text", () => {
    const lines = groupLines([item("This is a long sentence that", 300, 100), item("wraps onto two lines", 340, 124)]);
    const [block] = groupBlocks(lines, 960);
    expect(block.paragraphs).toHaveLength(1);
    expect(block.paragraphs[0].runs[0].text).toBe("This is a long sentence that wraps onto two lines");
    expect(block.paragraphs[0].align).toBe("center");
    expect(block.lineHeight).toBeUndefined(); // 24/20 = 1.2 = default
  });

  it("starts a new paragraph after a larger gap", () => {
    const [block] = groupBlocks(groupLines([item("One", 20, 100), item("Two", 20, 124), item("Three", 20, 160)]), 960);
    // "Two" follows at normal spacing (a wrapped line); "Three" follows a larger gap.
    expect(block.paragraphs.map((p) => p.runs[0].text)).toEqual(["One Two", "Three"]);
    expect(block.paragraphs[1].spaceBefore).toBeGreaterThan(0);
  });

  it("keeps table cells and chart labels as separate boxes", () => {
    // Table: 3 columns × 2 rows, rows 2 em apart, cells ~4.5 em apart (from a LibreOffice PDF).
    const cells = ["R1C0", "R1C1", "R1C2", "R2C0", "R2C1", "R2C2"].map((t, i) => item(t, 310 + (i % 3) * 120, 186 + Math.floor(i / 3) * 36, 18, { ascent: 0.95 }));
    const blocks = groupBlocks(groupLines(cells), 960);
    expect(blocks.map((b) => b.paragraphs.map((p) => p.runs.map((r) => r.text).join("")).join("/")).sort()).toEqual(["R1C0", "R1C1", "R1C2", "R2C0", "R2C1", "R2C2"]);
    // Axis label "0" and category "Q1" are close but not aligned like wrapped text.
    const axis = groupBlocks(groupLines([item("0", 95, 411, 18), item("Q1", 158, 429, 18)]), 960);
    expect(axis).toHaveLength(2);
    // Legend entries 1.5 em apart on one baseline stay separate (each sits next to its swatch).
    expect(groupBlocks(groupLines([item("Revenue", 263, 467, 18), item("Target", 353, 467, 18)]), 960)).toHaveLength(2);
  });
});

describe("pdf pixels", () => {
  const W = 10;
  const H = 10;
  const canvas = () => {
    const px = new Uint8ClampedArray(W * H * 4).fill(255);
    // Dark "glyph" block in the middle.
    for (let y = 4; y < 6; y++) for (let x = 3; x < 7; x++) px.set([20, 40, 200, 255], (y * W + x) * 4);
    return px;
  };

  it("samples background and ink colors, then erases the text", () => {
    const px = canvas();
    const box = { x: 3, y: 4, w: 4, h: 2 };
    const bg = ringColor(px, W, H, box, 1);
    expect(bg).toEqual([255, 255, 255]);
    expect(inkColor(px, W, H, box, bg)).toBe("#1428C8");
    eraseBoxes(px, W, H, [box], 1);
    expect(Array.from(px.slice((5 * W + 5) * 4, (5 * W + 5) * 4 + 3))).toEqual([255, 255, 255]);
  });
});
