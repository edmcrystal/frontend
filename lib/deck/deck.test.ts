import { describe, expect, it } from "vitest";
import { DeckSchema, emuToPt, ptToEmu, type Paragraph } from "./schema";
import { bulletLabels, gradientVector, presetPath } from "./render-utils";
import { sampleDeck } from "./fixtures/sample-deck";
import { getFixtureDeck } from "./fixtures";

const p = (bullet?: Paragraph["bullet"], level = 0): Paragraph => ({ align: "left", level, bullet, runs: [] });
const num = { type: "number", format: "arabic-period", startAt: 1 } as const;

describe("deck schema", () => {
  it("validates the sample fixture and fills defaults", () => {
    const deck = getFixtureDeck("sample")!;
    expect(deck.slides).toHaveLength(sampleDeck.slides.length);
    const text = deck.slides[0].elements[0];
    expect(text.type === "text" && text.autofit).toBe("none");
  });

  it("rejects invalid colors and unknown element types", () => {
    const bad = structuredClone(sampleDeck) as any;
    bad.slides[0].background = { type: "solid", color: "blue" };
    expect(DeckSchema.safeParse(bad).success).toBe(false);
    const bad2 = structuredClone(sampleDeck) as any;
    bad2.slides[0].elements.push({ id: "x", type: "video", frame: { x: 0, y: 0, w: 1, h: 1 } });
    expect(DeckSchema.safeParse(bad2).success).toBe(false);
  });

  it("validates nested group children", () => {
    const bad = structuredClone(sampleDeck) as any;
    bad.slides[1].elements[2].children[0].frame.w = -5;
    expect(DeckSchema.safeParse(bad).success).toBe(false);
  });

  it("converts points to EMU and back", () => {
    expect(ptToEmu(960)).toBe(12192000); // 13.333in slide width
    expect(emuToPt(6858000)).toBe(540);
  });
});

describe("bulletLabels", () => {
  it("numbers consecutive paragraphs and honours startAt", () => {
    expect(bulletLabels([p({ ...num, startAt: 3 }), p(num), p(num)])).toEqual(["3.", "4.", "5."]);
  });

  it("keeps the count across deeper levels but restarts after a break", () => {
    const labels = bulletLabels([p(num), p({ type: "char", char: "–" }, 1), p(num), p(), p(num)]);
    expect(labels).toEqual(["1.", "–", "2.", null, "1."]);
  });

  it("formats letters and roman numerals", () => {
    expect(bulletLabels([p({ ...num, format: "alpha-lower", startAt: 26 }), p({ ...num, format: "alpha-lower" })])).toEqual(["z.", "aa."]);
    expect(bulletLabels([p({ ...num, format: "roman-upper", startAt: 14 })])).toEqual(["XIV."]);
  });
});

describe("geometry helpers", () => {
  it("maps CSS gradient angles to SVG vectors", () => {
    const v = gradientVector(90); // to right
    expect(v.x1).toBeCloseTo(0);
    expect(v.x2).toBeCloseTo(1);
    expect(v.y1).toBeCloseTo(0.5);
  });

  it("builds closed preset paths", () => {
    expect(presetPath("rect", 10, 5)).toBe("M0 0H10V5H0Z");
    expect(presetPath("triangle", 10, 10)).toBe("M5 0L10 10H0Z");
  });
});
