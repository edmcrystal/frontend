import { describe, expect, it } from "vitest";
import { describeOutcome, formatSlideRanges, pictureOnlySlides } from "./summary";
import { getFixtureDeck } from "../deck/fixtures";
import type { Deck } from "../deck/schema";

const pictureSlide = { id: "p", background: { type: "image" as const, assetId: "a", fit: "stretch" as const }, elements: [] };

describe("formatSlideRanges", () => {
  it("collapses runs and keeps singles", () => {
    expect(formatSlideRanges([1, 2, 3, 5, 7, 8])).toBe("1–3, 5, 7–8");
    expect(formatSlideRanges([14, 1, 2, 2])).toBe("1–2, 14");
    expect(formatSlideRanges([4])).toBe("4");
    expect(formatSlideRanges([])).toBe("");
  });
});

describe("pictureOnlySlides", () => {
  it("counts only empty slides whose background is an image", () => {
    const deck = getFixtureDeck("sample")!;
    expect(pictureOnlySlides(deck)).toEqual([]);
    const mixed: Deck = {
      ...deck,
      slides: [
        { ...pictureSlide, id: "a" },
        deck.slides[0],
        { ...pictureSlide, id: "b", background: { type: "solid", color: "#FFFFFF" } }, // a blank slide, not a picture
        { ...pictureSlide, id: "c" },
      ],
    };
    expect(pictureOnlySlides(mixed)).toEqual([1, 4]);
  });
});

describe("describeOutcome", () => {
  const report = (pictureOnlySlides: number[]) => ({ fileName: "deck.pdf", pictureOnlySlides });

  it("says plainly when nothing came in editable", () => {
    const o = describeOutcome(report([1, 2, 3]), "My deck", 3);
    expect(o.tone).toBe("none");
    expect(o.headline).toContain("pictures only");
    expect(o.summary).toContain("0 of 3 slides");
    expect(o.advice).toMatch(/OCR/);
    expect(`${o.headline}${o.summary}${o.advice}`).not.toMatch(/everything.*editable/i);
  });

  it("names the picture-only slides when only some are", () => {
    const o = describeOutcome(report([2, 3, 7]), "Mixed", 8);
    expect(o.tone).toBe("partial");
    expect(o.summary).toContain("5 of 8 slides");
    expect(o.advice).toBe("Slides 2–3, 7 are pictures only: they contain no text or shapes to read.");
    expect(describeOutcome(report([4]), "Mixed", 8).advice).toMatch(/^Slide 4 is pictures only: it contains/);
  });

  it("makes no extra claim when every slide has content", () => {
    const o = describeOutcome(report([]), "Good", 1);
    expect(o).toEqual({ tone: "full", headline: "Imported “Good”", summary: "From deck.pdf · 1 slide." });
  });
});
