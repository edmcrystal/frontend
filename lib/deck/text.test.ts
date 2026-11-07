import { describe, expect, it } from "vitest";
import { docToParagraphs, paragraphsToDoc, toHexColor, type PMNode } from "./text";
import type { Paragraph } from "./schema";
import { getFixtureDeck } from "./fixtures";

const base = { font: "Arial", size: 20, color: "#111111" };

describe("text conversion", () => {
  it("round-trips every text element in the sample deck", () => {
    const deck = getFixtureDeck("sample")!;
    const all: Paragraph[][] = [];
    const visit = (els: (typeof deck.slides)[number]["elements"]) =>
      els.forEach((e) => {
        if (e.type === "text") all.push(e.paragraphs);
        if (e.type === "shape" && e.paragraphs) all.push(e.paragraphs);
        if (e.type === "group") visit(e.children);
      });
    deck.slides.forEach((s) => visit(s.elements));
    expect(all.length).toBeGreaterThan(5);
    for (const ps of all) {
      const back = docToParagraphs(paragraphsToDoc(ps), base);
      expect(back).toEqual(ps.map((p) => ({ ...p, runs: p.runs })));
    }
  });

  it("keeps line breaks and merges adjacent runs with the same style", () => {
    const ps: Paragraph[] = [{ align: "center", level: 0, runs: [{ text: "a\nb", ...base }, { text: "c", ...base }] }];
    const doc = paragraphsToDoc(ps);
    expect(doc.content![0].content!.map((n) => n.type)).toEqual(["text", "hardBreak", "text", "text"]);
    expect(docToParagraphs(doc, base)[0].runs).toEqual([{ text: "a\nbc", ...base }]);
  });

  it("keeps the style of empty paragraphs", () => {
    const ps: Paragraph[] = [{ align: "left", level: 1, runs: [{ text: "", font: "Georgia", size: 40, color: "#FF0000" }] }];
    expect(docToParagraphs(paragraphsToDoc(ps), base)).toEqual(ps);
  });

  it("normalizes pasted styles and fills gaps from defaults", () => {
    const doc: PMNode = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { align: "bogus", level: 99 },
          content: [
            { type: "text", text: "x", marks: [{ type: "textStyle", attrs: { fontFamily: '"Helvetica Neue", sans-serif', color: "rgb(255, 0, 0)", fontSize: "12pt" } }] },
            { type: "text", text: "y" },
          ],
        },
      ],
    };
    expect(docToParagraphs(doc, base)).toEqual([
      {
        align: "left",
        level: 8,
        runs: [
          { text: "x", font: "Helvetica Neue", size: 12, color: "#FF0000" },
          { text: "y", ...base },
        ],
      },
    ]);
  });

  it("parses css colors", () => {
    expect(toHexColor("#abc")).toBe("#AABBCC");
    expect(toHexColor("rgba(0, 0, 0, 0.5)")).toBe("#00000080");
    expect(toHexColor("red")).toBeNull();
  });
});
