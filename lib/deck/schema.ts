/**
 * Canonical deck model: the contract between importers, the editor and
 * exporters (see docs/editable-slides-plan.md §4).
 *
 * Units: points (1/72 in). Default 16:9 slide = 960 x 540 pt.
 * Points convert to PPTX EMU by multiplying by 12700.
 */
import { z } from "zod";

export const PT_PER_INCH = 72;
export const EMU_PER_PT = 12700;
export const DEFAULT_SLIDE_SIZE = { width: 960, height: 540 } as const;

const hexColor = z
  .string()
  .regex(/^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/, "Expected #RRGGBB or #RRGGBBAA");

// ---------- Primitives ----------

export const FrameSchema = z.object({
  x: z.number(),
  y: z.number(),
  w: z.number().nonnegative(),
  h: z.number().nonnegative(),
  rotation: z.number().default(0), // degrees, clockwise
});

export const GradientStopSchema = z.object({
  offset: z.number().min(0).max(1),
  color: hexColor,
});

export const FillSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("none") }),
  z.object({ type: z.literal("solid"), color: hexColor }),
  z.object({
    type: z.literal("linear-gradient"),
    angle: z.number(), // degrees, CSS convention
    stops: z.array(GradientStopSchema).min(2),
  }),
  z.object({
    type: z.literal("image"),
    assetId: z.string(),
    fit: z.enum(["cover", "contain", "stretch"]).default("cover"),
  }),
]);

export const StrokeSchema = z.object({
  color: hexColor,
  width: z.number().nonnegative(),
  dash: z.enum(["solid", "dash", "dot", "dash-dot"]).default("solid"),
});

export const ProvenanceSchema = z.object({
  source: z.enum(["native", "ocr", "vision", "ai-generated", "user"]),
  confidence: z.number().min(0).max(1).optional(),
  approximated: z.boolean().optional(),
});

// ---------- Theme ----------

export const ThemeSchema = z.object({
  name: z.string().default("Default"),
  colors: z.object({
    background: hexColor,
    text: hexColor,
    accent1: hexColor,
    accent2: hexColor,
    accent3: hexColor,
    accent4: hexColor,
    accent5: hexColor,
    accent6: hexColor,
  }),
  fonts: z.object({ heading: z.string(), body: z.string() }),
});

// ---------- Text ----------

export const RunSchema = z.object({
  text: z.string(),
  font: z.string(),
  size: z.number().positive(), // pt
  color: hexColor,
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  underline: z.boolean().optional(),
  strike: z.boolean().optional(),
  highlight: hexColor.optional(),
  link: z.string().url().optional(),
  letterSpacing: z.number().optional(), // pt
});

export const BulletSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("char"), char: z.string().min(1), color: hexColor.optional() }),
  z.object({
    type: z.literal("number"),
    format: z.enum(["arabic-period", "arabic-paren", "alpha-lower", "alpha-upper", "roman-lower", "roman-upper"]),
    startAt: z.number().int().positive().default(1),
  }),
]);

export const ParagraphSchema = z.object({
  align: z.enum(["left", "center", "right", "justify"]).default("left"),
  lineHeight: z.number().positive().optional(), // multiple of font size
  spaceBefore: z.number().nonnegative().optional(), // pt
  spaceAfter: z.number().nonnegative().optional(), // pt
  level: z.number().int().min(0).max(8).default(0),
  bullet: BulletSchema.optional(),
  runs: z.array(RunSchema),
});

// ---------- Charts ----------

export const ChartSpecSchema = z.object({
  type: z.enum(["bar", "column", "line", "area", "pie", "donut", "scatter"]),
  title: z.string().optional(),
  categories: z.array(z.string()),
  series: z
    .array(
      z.object({
        name: z.string(),
        values: z.array(z.number().nullable()),
        color: hexColor.optional(),
      }),
    )
    .min(1),
  stacked: z.boolean().optional(),
  legend: z.enum(["none", "top", "bottom", "left", "right"]).default("bottom"),
  dataLabels: z.boolean().optional(),
  axes: z
    .object({ xTitle: z.string().optional(), yTitle: z.string().optional() })
    .optional(),
});

// ---------- Elements ----------

const baseElement = {
  id: z.string(),
  name: z.string().optional(),
  frame: FrameSchema,
  opacity: z.number().min(0).max(1).optional(),
  locked: z.boolean().optional(),
  hidden: z.boolean().optional(),
  provenance: ProvenanceSchema.optional(),
};

export const PRESET_SHAPES = [
  "rect",
  "round-rect",
  "ellipse",
  "triangle",
  "diamond",
  "chevron",
  "arrow-right",
  "line",
] as const;

export const TextElementSchema = z.object({
  ...baseElement,
  type: z.literal("text"),
  role: z.enum(["title", "subtitle", "body", "bullet", "caption", "footer"]).optional(),
  autofit: z.enum(["none", "shrink", "resize"]).default("none"),
  padding: z.tuple([z.number(), z.number(), z.number(), z.number()]).default([7.2, 3.6, 7.2, 3.6]), // t r b l (PPTX defaults)
  verticalAlign: z.enum(["top", "middle", "bottom"]).default("top"),
  fill: FillSchema.optional(),
  paragraphs: z.array(ParagraphSchema),
});

export const ImageElementSchema = z.object({
  ...baseElement,
  type: z.literal("image"),
  assetId: z.string(),
  crop: z
    .object({ l: z.number(), t: z.number(), r: z.number(), b: z.number() }) // fractions 0..1
    .optional(),
  mask: z.enum(["rect", "ellipse", "rounded"]).default("rect"),
  alt: z.string().optional(),
});

export const ShapeElementSchema = z.object({
  ...baseElement,
  type: z.literal("shape"),
  geometry: z.union([
    z.object({ preset: z.enum(PRESET_SHAPES) }),
    z.object({ path: z.string(), viewBox: z.tuple([z.number(), z.number(), z.number(), z.number()]) }),
  ]),
  fill: FillSchema,
  stroke: StrokeSchema.optional(),
  paragraphs: z.array(ParagraphSchema).optional(),
  verticalAlign: z.enum(["top", "middle", "bottom"]).default("middle"),
});

export const TableCellSchema = z.object({
  paragraphs: z.array(ParagraphSchema),
  fill: FillSchema.optional(),
  colSpan: z.number().int().positive().optional(),
  rowSpan: z.number().int().positive().optional(),
});

export const TableElementSchema = z.object({
  ...baseElement,
  type: z.literal("table"),
  columns: z.array(z.number().positive()), // column widths, pt
  rows: z.array(z.object({ height: z.number().positive(), cells: z.array(TableCellSchema) })),
  border: StrokeSchema.optional(),
});

export const ChartElementSchema = z.object({
  ...baseElement,
  type: z.literal("chart"),
  spec: ChartSpecSchema,
});

export const IconElementSchema = z.object({
  ...baseElement,
  type: z.literal("icon"),
  svg: z.string(), // inner SVG markup; rendered with currentColor
  viewBox: z.tuple([z.number(), z.number(), z.number(), z.number()]).default([0, 0, 24, 24]),
  color: hexColor,
  iconId: z.string().optional(),
});

type GroupElementInput = z.input<typeof baseGroupSchema> & { children: ElementInput[] };
type GroupElementOutput = z.output<typeof baseGroupSchema> & { children: Element[] };

const baseGroupSchema = z.object({
  ...baseElement,
  type: z.literal("group"),
  infographic: z.object({ templateId: z.string(), data: z.unknown() }).optional(),
});

export const GroupElementSchema: z.ZodType<GroupElementOutput, z.ZodTypeDef, GroupElementInput> =
  baseGroupSchema.extend({
    children: z.lazy(() => z.array(ElementSchema)),
  });

export const ElementSchema: z.ZodType<Element, z.ZodTypeDef, ElementInput> = z.lazy(() =>
  z.union([
    TextElementSchema,
    ImageElementSchema,
    ShapeElementSchema,
    TableElementSchema,
    ChartElementSchema,
    IconElementSchema,
    GroupElementSchema,
  ]),
);

// ---------- Slides & decks ----------

export const AssetSchema = z.object({
  id: z.string(),
  kind: z.enum(["image", "font"]),
  url: z.string(),
  mime: z.string(),
  width: z.number().optional(),
  height: z.number().optional(),
  attribution: z.string().optional(),
});

export const SlideSchema = z.object({
  id: z.string(),
  background: FillSchema,
  elements: z.array(ElementSchema), // array order = z-order (first = back)
  notes: z.string().optional(),
  layoutHint: z.string().optional(),
  thumbnailUrl: z.string().optional(),
});

export const DeckSchema = z.object({
  id: z.string(),
  title: z.string(),
  version: z.number().int().nonnegative(),
  size: z.object({ width: z.number().positive(), height: z.number().positive() }),
  theme: ThemeSchema,
  slides: z.array(SlideSchema),
  assets: z.record(z.string(), AssetSchema),
  source: z
    .object({
      kind: z.enum(["pdf", "pptx"]),
      fileId: z.string(),
      pageCount: z.number().int().nonnegative(),
    })
    .optional(),
});

// ---------- Types ----------

export type Frame = z.infer<typeof FrameSchema>;
export type Fill = z.infer<typeof FillSchema>;
export type Stroke = z.infer<typeof StrokeSchema>;
export type Provenance = z.infer<typeof ProvenanceSchema>;
export type Theme = z.infer<typeof ThemeSchema>;
export type Run = z.infer<typeof RunSchema>;
export type Bullet = z.infer<typeof BulletSchema>;
export type Paragraph = z.infer<typeof ParagraphSchema>;
export type ChartSpec = z.infer<typeof ChartSpecSchema>;
export type PresetShape = (typeof PRESET_SHAPES)[number];
export type TextElement = z.infer<typeof TextElementSchema>;
export type ImageElement = z.infer<typeof ImageElementSchema>;
export type ShapeElement = z.infer<typeof ShapeElementSchema>;
export type TableElement = z.infer<typeof TableElementSchema>;
export type ChartElement = z.infer<typeof ChartElementSchema>;
export type IconElement = z.infer<typeof IconElementSchema>;
export type GroupElement = GroupElementOutput;
export type Element =
  | TextElement
  | ImageElement
  | ShapeElement
  | TableElement
  | ChartElement
  | IconElement
  | GroupElement;
type ElementInput =
  | z.input<typeof TextElementSchema>
  | z.input<typeof ImageElementSchema>
  | z.input<typeof ShapeElementSchema>
  | z.input<typeof TableElementSchema>
  | z.input<typeof ChartElementSchema>
  | z.input<typeof IconElementSchema>
  | GroupElementInput;
export type Asset = z.infer<typeof AssetSchema>;
export type Slide = z.infer<typeof SlideSchema>;
export type Deck = z.infer<typeof DeckSchema>;
export type DeckInput = z.input<typeof DeckSchema>;

/** Validates unknown JSON (e.g. an API response) and fills defaults. Throws ZodError. */
export function parseDeck(input: unknown): Deck {
  return DeckSchema.parse(input);
}

export const ptToEmu = (pt: number) => Math.round(pt * EMU_PER_PT);
export const emuToPt = (emu: number) => emu / EMU_PER_PT;
