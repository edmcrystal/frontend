import { describe, expect, it } from "vitest";
import { addColumn, addRow, layoutCells, removeLastColumn, removeLastRow } from "./table";
import type { TableElement } from "./schema";

const cell = (text: string, extra: { colSpan?: number; rowSpan?: number } = {}) => ({
  ...extra,
  paragraphs: [{ align: "left" as const, level: 0, runs: [{ text, font: "Arial", size: 12, color: "#000000" }] }],
});
const texts = (t: Pick<TableElement, "rows">) => t.rows.map((r) => r.cells.map((c) => c.paragraphs[0].runs[0].text));

// 3x3:  A A B      (A spans 2 columns)
//       C D B      (B spans 2 rows)
//       E F G
function table(): Pick<TableElement, "columns" | "rows"> {
  return {
    columns: [100, 100, 100],
    rows: [
      { height: 30, cells: [cell("A", { colSpan: 2 }), cell("B", { rowSpan: 2 })] },
      { height: 30, cells: [cell("C"), cell("D")] },
      { height: 30, cells: [cell("E"), cell("F"), cell("G")] },
    ],
  };
}

describe("table helpers", () => {
  it("places cells around merges", () => {
    expect(layoutCells(table()).map((p) => [p.row, p.col, p.colSpan, p.rowSpan])).toEqual([
      [0, 0, 2, 1],
      [0, 2, 1, 2],
      [1, 0, 1, 1],
      [1, 1, 1, 1],
      [2, 0, 1, 1],
      [2, 1, 1, 1],
      [2, 2, 1, 1],
    ]);
  });

  it("adds full rows and columns", () => {
    const t = table();
    expect(addRow(t)).toBe(30);
    expect(t.rows[3].cells).toHaveLength(3);
    expect(addColumn(t)).toBe(100);
    expect(layoutCells(t).filter((p) => p.col === 3)).toHaveLength(4);
  });

  it("removes the last column, shrinking or dropping merged cells", () => {
    const t = table();
    removeLastColumn(t);
    expect(t.columns).toEqual([100, 100]);
    expect(texts(t)).toEqual([["A"], ["C", "D"], ["E", "F"]]);
    expect(t.rows[0].cells[0].colSpan).toBe(2);
    removeLastColumn(t);
    expect(texts(t)).toEqual([["A"], ["C"], ["E"]]);
    expect(t.rows[0].cells[0].colSpan).toBeUndefined();
  });

  it("removes the last row, shortening row merges that reach it", () => {
    const t = table();
    removeLastRow(t);
    removeLastRow(t);
    expect(texts(t)).toEqual([["A", "B"]]);
    expect(t.rows[0].cells[1].rowSpan).toBeUndefined();
    expect(removeLastRow(t)).toBe(0);
  });
});
