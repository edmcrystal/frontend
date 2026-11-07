/**
 * PowerPoint (.pptx) → Deck, entirely from the file's XML ("native" import):
 * text stays text, shapes stay shapes, charts keep their data.
 */
import { DeckSchema, type Deck, type Element, type Fill, type Slide, type Theme } from "@/lib/deck/schema";
import { newId } from "@/lib/deck/commands";
import { attr, child, children, find, findAll, numAttr, path, relAttr, type XNode } from "../xml";
import { emuToPt, parseColorMap, parseColorScheme, type ColorContext } from "../color";
import { ImportError, MAX_PAGES, throwIfAborted, type ImportOptions, type ImportResult } from "../types";
import { Package } from "./package";
import { count, parseBackground, warn, type DeckContext, type PartRef, type SlideContext, type ThemeInfo } from "./context";
import { parseTree, ROOT_MAPPER } from "./shapes";

const LAYOUT_HINTS: Record<string, string> = {
  title: "title",
  obj: "title-content",
  tx: "title-content",
  twoObj: "two-column",
  twoTxTwoObj: "two-column",
  secHead: "section",
  titleOnly: "title-only",
  blank: "blank",
  picTx: "picture-caption",
};

const FALLBACK_SCHEME = {
  dk1: "#000000",
  lt1: "#FFFFFF",
  dk2: "#44546A",
  lt2: "#E7E6E6",
  accent1: "#4472C4",
  accent2: "#ED7D31",
  accent3: "#A5A5A5",
  accent4: "#FFC000",
  accent5: "#5B9BD5",
  accent6: "#70AD47",
  hlink: "#0563C1",
  folHlink: "#954F72",
};

function parseTheme(root: XNode | null): ThemeInfo {
  const elements = path(root ?? undefined, "themeElements");
  const fonts = child(elements, "fontScheme");
  const fmt = child(elements, "fmtScheme");
  return {
    colors: { ...FALLBACK_SCHEME, ...parseColorScheme(child(elements, "clrScheme")) },
    majorFont: attr(path(fonts, "majorFont", "latin"), "typeface") || "Calibri",
    minorFont: attr(path(fonts, "minorFont", "latin"), "typeface") || "Calibri",
    fillStyles: children(child(fmt, "fillStyleLst")),
    bgFillStyles: children(child(fmt, "bgFillStyleLst")),
    lineStyles: children(child(fmt, "lnStyleLst")),
  };
}

function plainText(root: XNode | undefined): string {
  return children(root, "p")
    .map((p) => findAll(p, "t").map((t) => t.text).join(""))
    .join("\n")
    .trim();
}

function lockAll(els: Element[]): Element[] {
  return els.map((el) => ({ ...el, locked: true, name: el.name ?? "From slide master" }));
}

async function notesFor(pkg: Package, slidePart: string): Promise<string | undefined> {
  const rel = await pkg.relOfType(slidePart, "notesSlide");
  const root = rel && (await pkg.xml(rel.target));
  if (!root) return undefined;
  const body = findAll(root, "sp").find((sp) => attr(find(sp, "ph"), "type") === "body");
  const text = plainText(child(body, "txBody"));
  return text || undefined;
}

export async function importPptx(data: ArrayBuffer | Uint8Array, fileName: string, opts: ImportOptions = {}): Promise<ImportResult> {
  const { onProgress, signal } = opts;
  onProgress?.({ stage: "reading", current: 0, total: 0, message: "Opening presentation" });
  let pkg: Package;
  try {
    pkg = await Package.open(data);
  } catch {
    throw new ImportError("This file isn't a valid PowerPoint (.pptx) file.");
  }
  const presPart = "ppt/presentation.xml";
  const pres = await pkg.xml(presPart);
  if (!pres) throw new ImportError("This file isn't a PowerPoint presentation (ppt/presentation.xml is missing).");

  const sldSz = child(pres, "sldSz");
  const size = { width: Math.round(emuToPt(numAttr(sldSz, "cx") ?? 12192000) * 100) / 100, height: Math.round(emuToPt(numAttr(sldSz, "cy") ?? 6858000) * 100) / 100 };

  const presRels = await pkg.rels(presPart);
  const slideParts = children(child(pres, "sldIdLst"), "sldId")
    .map((s) => presRels.find((r) => r.id === relAttr(s, "id"))?.target)
    .filter((p): p is string => !!p && pkg.has(p));
  if (slideParts.length === 0) throw new ImportError("The presentation has no slides.");

  const deckCtx: DeckContext = {
    pkg,
    theme: parseTheme(null),
    assets: {},
    assetByPath: new Map(),
    warnings: [],
    counts: {},
    defaultTextStyle: child(pres, "defaultTextStyle"),
  };
  if (slideParts.length > MAX_PAGES) {
    warn(deckCtx, `Only the first ${MAX_PAGES} of ${slideParts.length} slides were imported.`);
    slideParts.length = MAX_PAGES;
  }

  const firstMasterRel = presRels.find((r) => r.type === "slideMaster");
  const themeRel = firstMasterRel ? await pkg.relOfType(firstMasterRel.target, "theme") : presRels.find((r) => r.type === "theme");
  deckCtx.theme = parseTheme(themeRel ? await pkg.xml(themeRel.target) : null);
  const deckColorMap = parseColorMap(firstMasterRel ? child(await pkg.xml(firstMasterRel.target), "clrMap") : undefined);

  const slides: Slide[] = [];
  let firstTitle: string | undefined;
  for (let i = 0; i < slideParts.length; i++) {
    throwIfAborted(signal);
    onProgress?.({ stage: "parsing", current: i + 1, total: slideParts.length, message: `Slide ${i + 1} of ${slideParts.length}` });
    const part = slideParts[i];
    const root = (await pkg.xml(part))!;
    const layoutRel = await pkg.relOfType(part, "slideLayout");
    const layoutRoot = layoutRel ? await pkg.xml(layoutRel.target) : null;
    const masterRel = layoutRel ? await pkg.relOfType(layoutRel.target, "slideMaster") : undefined;
    const masterRoot = masterRel ? await pkg.xml(masterRel.target) : null;
    const layout: PartRef | undefined = layoutRel && layoutRoot ? { part: layoutRel.target, root: layoutRoot } : undefined;
    const master: PartRef | undefined = masterRel && masterRoot ? { part: masterRel.target, root: masterRoot } : undefined;

    let map = parseColorMap(child(master?.root, "clrMap"));
    for (const ovr of [layout?.root, root]) {
      const o = path(ovr, "clrMapOvr", "overrideClrMapping");
      if (o) map = parseColorMap(o);
    }
    const color: ColorContext = { scheme: deckCtx.theme.colors, map };
    const ctx: SlideContext = { ...deckCtx, slideNo: i + 1, slide: { part, root }, layout, master, color, part };

    let background: Fill | undefined;
    for (const src of [{ r: root, p: part }, { r: layout?.root, p: layout?.part }, { r: master?.root, p: master?.part }]) {
      if (!src.r || !src.p) continue;
      background = await parseBackground(src.r, { ...ctx, part: src.p });
      if (background) break;
    }

    const elements: Element[] = [];
    const showMaster = attr(root, "showMasterSp") !== "0";
    if (showMaster && master && attr(layout?.root, "showMasterSp") !== "0") {
      const tree = path(master.root, "cSld", "spTree");
      if (tree) elements.push(...lockAll(await parseTree(tree, { ...ctx, part: master.part }, ROOT_MAPPER, true)));
    }
    if (showMaster && layout) {
      const tree = path(layout.root, "cSld", "spTree");
      if (tree) elements.push(...lockAll(await parseTree(tree, { ...ctx, part: layout.part }, ROOT_MAPPER, true)));
    }
    const tree = path(root, "cSld", "spTree");
    if (tree) elements.push(...(await parseTree(tree, ctx, ROOT_MAPPER)));

    const slide: Slide = {
      id: newId("slide"),
      background: background ?? { type: "solid", color: deckCtx.theme.colors[map.bg1] ?? "#FFFFFF" },
      elements,
    };
    const hint = LAYOUT_HINTS[attr(layout?.root, "type") ?? ""];
    if (hint) slide.layoutHint = hint;
    const notes = await notesFor(pkg, part);
    if (notes) slide.notes = notes;
    if (attr(root, "show") === "0") warn(ctx, "This slide is hidden in the original presentation.");
    if (!firstTitle) {
      const title = elements.find((e) => e.type === "text" && e.role === "title");
      if (title?.type === "text") firstTitle = title.paragraphs.map((p) => p.runs.map((r) => r.text).join("")).join(" ").trim() || undefined;
    }
    slides.push(slide);
    count(deckCtx, "slide");
  }

  onProgress?.({ stage: "assembling", current: slides.length, total: slides.length, message: "Finishing up" });
  const core = await pkg.xml("docProps/core.xml");
  const docTitle = find(core ?? undefined, "title")?.text.trim();
  const scheme = deckCtx.theme.colors;
  const theme: Theme = {
    name: "Imported theme",
    colors: {
      background: scheme[deckColorMap.bg1] ?? "#FFFFFF",
      text: scheme[deckColorMap.tx1] ?? "#000000",
      accent1: scheme.accent1,
      accent2: scheme.accent2,
      accent3: scheme.accent3,
      accent4: scheme.accent4,
      accent5: scheme.accent5,
      accent6: scheme.accent6,
    },
    fonts: { heading: deckCtx.theme.majorFont, body: deckCtx.theme.minorFont },
  };
  const deck: Deck = DeckSchema.parse({
    id: newId("deck"),
    title: docTitle || firstTitle || fileName.replace(/\.pptx$/i, ""),
    version: 1,
    size,
    theme,
    slides,
    assets: deckCtx.assets,
    source: { kind: "pptx", fileId: fileName, pageCount: slides.length },
  });
  onProgress?.({ stage: "done", current: slides.length, total: slides.length });
  return { deck, report: { sourceKind: "pptx", fileName, warnings: deckCtx.warnings, counts: deckCtx.counts } };
}
