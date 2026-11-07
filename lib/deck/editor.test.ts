import { beforeEach, describe, expect, it } from "vitest";
import { aabb, resizeFrame, rotationFromPointer, snapBox, snapTargets } from "./geometry";
import {
  alignElements,
  deleteSlide,
  distributeElements,
  duplicateElements,
  duplicateSlide,
  groupElements,
  locate,
  moveSlide,
  reorderElements,
  setFrames,
  ungroupElements,
} from "./commands";
import { useEditor } from "./store";
import { getFixtureDeck } from "./fixtures";
import { createShape } from "./factories";
import type { Frame } from "./schema";

const f = (x: number, y: number, w: number, h: number, rotation = 0): Frame => ({ x, y, w, h, rotation });
const close = (a: Frame, b: Frame) => {
  for (const k of ["x", "y", "w", "h", "rotation"] as const) expect(a[k]).toBeCloseTo(b[k], 6);
};

describe("resizeFrame", () => {
  it("moves only the dragged corner on an unrotated frame", () => {
    close(resizeFrame(f(10, 10, 100, 50), "se", 20, 10), f(10, 10, 120, 60));
    close(resizeFrame(f(10, 10, 100, 50), "nw", 20, 10), f(30, 20, 80, 40));
    close(resizeFrame(f(10, 10, 100, 50), "e", 20, 999), f(10, 10, 120, 50));
  });

  it("keeps ratio on corners and grows edges symmetrically", () => {
    close(resizeFrame(f(0, 0, 100, 50), "se", 100, 0, { keepRatio: true }), f(0, 0, 200, 100));
    close(resizeFrame(f(0, 0, 100, 50), "e", 100, 0, { keepRatio: true }), f(0, -25, 200, 100));
  });

  it("resizes from the center", () => {
    close(resizeFrame(f(0, 0, 100, 100), "e", 10, 0, { fromCenter: true }), f(-10, 0, 120, 100));
  });

  it("keeps the opposite corner fixed on a rotated frame", () => {
    const start = f(100, 100, 100, 50, 90);
    const before = aabb(start);
    // Rotated 90°: the local "se" handle sits at the world bottom-left; local +x points down.
    const out = resizeFrame(start, "se", 0, 40);
    const after = aabb(out);
    expect(out.w).toBeCloseTo(140);
    expect(out.h).toBeCloseTo(50);
    expect(after.y).toBeCloseTo(before.y); // top (anchored, local nw) stays put
    expect(after.x + after.w).toBeCloseTo(before.x + before.w);
  });

  it("enforces a minimum size", () => {
    const out = resizeFrame(f(0, 0, 100, 100), "se", -500, -500);
    expect(out.w).toBe(4);
    expect(out.h).toBe(4);
    expect(out.x).toBe(0);
  });
});

describe("rotation and snapping", () => {
  it("measures rotation from straight up, with 15° snapping", () => {
    expect(rotationFromPointer({ x: 0, y: 0 }, { x: 0, y: -10 }, false)).toBeCloseTo(0);
    expect(rotationFromPointer({ x: 0, y: 0 }, { x: 10, y: 0 }, false)).toBeCloseTo(90);
    expect(rotationFromPointer({ x: 0, y: 0 }, { x: 10, y: -9 }, true)).toBe(45);
    expect(rotationFromPointer({ x: 0, y: 0 }, { x: -10, y: 0 }, false)).toBeCloseTo(-90);
  });

  it("snaps a box to the slide center and reports a guide", () => {
    const t = snapTargets({ width: 960, height: 540 }, []);
    const r = snapBox({ x: 428, y: 100, w: 100, h: 50 }, t, 5);
    expect(r.dx).toBe(2); // center 478 -> 480
    expect(r.dy).toBe(0);
    expect(r.guides).toEqual([{ axis: "x", pos: 480 }]);
  });
});

describe("commands", () => {
  const deck = () => getFixtureDeck("sample")!;

  it("groups and ungroups without moving anything on screen", async () => {
    const { produce } = await import("immer");
    const d0 = deck();
    const ids = ["s3-table", "s3-callout"];
    const before = ids.map((id) => locate(d0.slides[2].elements, id)!.el.frame);
    let groupId = "";
    const grouped = produce(d0, (d) => {
      groupId = groupElements(d, "s3", ids)!;
    });
    const g = locate(grouped.slides[2].elements, groupId)!;
    expect(g.el.type).toBe("group");
    expect(g.index).toBe(2); // takes the topmost member's slot
    const ungrouped = produce(grouped, (d) => {
      ungroupElements(d, "s3", [groupId]);
    });
    ids.forEach((id, i) => close(locate(ungrouped.slides[2].elements, id)!.el.frame, before[i]));
  });

  it("ungroups a rotated group into rotated children", async () => {
    const { produce } = await import("immer");
    const d0 = produce(deck(), (d) => {
      const g = locate(d.slides[1].elements, "s2-card")!.el;
      g.frame.rotation = 90;
    });
    const out = produce(d0, (d) => {
      ungroupElements(d, "s2", ["s2-card"]);
    });
    const bg = locate(out.slides[1].elements, "s2-card-bg")!.el.frame;
    expect(bg.rotation).toBe(90);
    // Card is 300x300 and its background fills it, so the background keeps the group's place.
    close(bg, f(600, 130, 300, 300, 90));
  });

  it("reorders, aligns and distributes", async () => {
    const { produce } = await import("immer");
    const out = produce(deck(), (d) => {
      reorderElements(d, "s3", ["s3-title"], "front");
      alignElements(d, "s3", ["s3-chart"], "right");
    });
    const els = out.slides[2].elements;
    expect(els[els.length - 1].id).toBe("s3-title");
    const chart = locate(els, "s3-chart")!.el.frame;
    expect(chart.x + chart.w).toBe(960);

    const d1 = produce(deck(), (d) => {
      setFrames(d, "s3", { "s3-title": f(0, 0, 100, 10), "s3-chart": f(50, 0, 100, 10), "s3-table": f(400, 0, 100, 10) });
      distributeElements(d, "s3", ["s3-title", "s3-chart", "s3-table"], "x");
    });
    expect(locate(d1.slides[2].elements, "s3-chart")!.el.frame.x).toBe(200);
  });

  it("duplicates elements and slides with fresh ids", async () => {
    const { produce } = await import("immer");
    let ids: string[] = [];
    let slideId = "";
    const out = produce(deck(), (d) => {
      ids = duplicateElements(d, "s2", ["s2-card"]);
      slideId = duplicateSlide(d, "s2");
    });
    const copy = locate(out.slides[1].elements, ids[0])!.el;
    expect(copy.type === "group" && copy.children.every((c) => !c.id.startsWith("s2-card"))).toBe(true);
    expect(out.slides[2].id).toBe(slideId);
    expect(out.slides[2].elements.map((e) => e.id)).not.toContain("s2-title");
  });

  it("moves and deletes slides but never the last one", async () => {
    const { produce } = await import("immer");
    const out = produce(deck(), (d) => {
      moveSlide(d, 0, 3);
    });
    expect(out.slides.map((s) => s.id)).toEqual(["s2", "s3", "s4", "s1"]);
    const single = produce(deck(), (d) => {
      d.slides.splice(1);
      expect(deleteSlide(d, "s1")).toBe("s1");
    });
    expect(single.slides).toHaveLength(1);
  });
});

describe("store history", () => {
  beforeEach(() => useEditor.getState().load(getFixtureDeck("sample")!));

  it("undoes and redoes commits", () => {
    const s = useEditor.getState();
    const original = s.deck;
    s.commit((d) => {
      d.title = "Changed";
    });
    expect(useEditor.getState().deck!.title).toBe("Changed");
    useEditor.getState().undo();
    expect(useEditor.getState().deck).toBe(original);
    useEditor.getState().redo();
    expect(useEditor.getState().deck!.title).toBe("Changed");
  });

  it("merges commits with the same key into one undo step", () => {
    const s = useEditor.getState();
    for (let i = 1; i <= 5; i++)
      s.commit((d) => setFrames(d, "s1", { "s1-bar": f(i, i, 10, 10) }), { key: "drag-1" });
    expect(useEditor.getState().past).toHaveLength(1);
    useEditor.getState().undo();
    expect(locate(useEditor.getState().deck!.slides[0].elements, "s1-bar")!.el.frame.x).toBe(80);
  });

  it("skips no-op commits and drops selection of deleted elements", () => {
    const s = useEditor.getState();
    s.commit(() => {});
    expect(useEditor.getState().past).toHaveLength(0);
    s.setSlide("s1");
    s.select(["s1-bar"]);
    s.commit((d) => {
      d.slides[0].elements = d.slides[0].elements.filter((e) => e.id !== "s1-bar");
    });
    expect(useEditor.getState().selection).toEqual([]);
  });

  it("returns values from commit and inserts new elements", () => {
    const s = useEditor.getState();
    const shape = createShape(s.deck!, "ellipse");
    const n = s.commit((d) => {
      d.slides[0].elements.push(shape);
      return d.slides[0].elements.length;
    });
    expect(n).toBe(4);
  });
});
