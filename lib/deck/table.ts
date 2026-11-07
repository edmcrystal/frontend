/**
 * Table grid helpers that understand merged cells. Cells covered by a merge
 * are omitted from `row.cells`; the merging cell's colSpan/rowSpan covers them
 * (the same convention as PPTX and pptxgenjs).
 */
import type { TableElement } from "./schema";

type Table = Pick<TableElement, "columns" | "rows">;
type Cell = TableElement["rows"][number]["cells"][number];

export type PlacedCell = { row: number; index: number; col: number; colSpan: number; rowSpan: number };

/** Grid position of every cell, skipping slots covered by merges. */
export function layoutCells(t: Table): PlacedCell[] {
  const taken = new Set<string>();
  const out: PlacedCell[] = [];
  t.rows.forEach((row, r) => {
    let col = 0;
    row.cells.forEach((cell, index) => {
      while (taken.has(`${r}:${col}`)) col++;
      const colSpan = Math.max(1, Math.min(cell.colSpan ?? 1, t.columns.length - col));
      const rowSpan = Math.max(1, Math.min(cell.rowSpan ?? 1, t.rows.length - r));
      for (let dr = 0; dr < rowSpan; dr++) for (let dc = 0; dc < colSpan; dc++) taken.add(`${r + dr}:${col + dc}`);
      out.push({ row: r, index, col, colSpan, rowSpan });
      col += colSpan;
    });
  });
  return out;
}

/** An empty cell with the same fill and text style as `like`. */
export function emptyCellLike(like: Cell | undefined): Cell {
  const p = like?.paragraphs[0];
  const run = p?.runs[0] ?? { font: "Arial", size: 14, color: "#000000", text: "" };
  return {
    ...(like?.fill ? { fill: structuredClone(like.fill) } : {}),
    paragraphs: [{ align: p?.align ?? "center", level: 0, runs: [{ ...structuredClone(run), text: "" }] }],
  };
}

/** Appends a full-width row styled like the first cell of the last row. Returns the added height. */
export function addRow(t: Table): number {
  const last = t.rows[t.rows.length - 1];
  const like = last?.cells[0];
  const height = last?.height ?? 36;
  t.rows.push({ height, cells: t.columns.map(() => emptyCellLike(like)) });
  return height;
}

/** Removes the last row, shortening merges that reach into it. Returns the removed height. */
export function removeLastRow(t: Table): number {
  if (t.rows.length <= 1) return 0;
  const last = t.rows.length - 1;
  for (const p of layoutCells(t)) {
    if (p.row < last && p.row + p.rowSpan - 1 >= last) {
      const cell = t.rows[p.row].cells[p.index];
      const span = p.rowSpan - 1;
      if (span > 1) cell.rowSpan = span;
      else delete cell.rowSpan;
    }
  }
  return t.rows.pop()!.height;
}

/** Appends a column (same width as the last). Returns the added width. */
export function addColumn(t: Table): number {
  const width = t.columns[t.columns.length - 1] ?? 120;
  t.columns.push(width);
  for (const row of t.rows) row.cells.push(emptyCellLike(row.cells[row.cells.length - 1] ?? t.rows[0]?.cells[0]));
  return width;
}

/** Removes the last column, shortening merges that reach into it. Returns the removed width. */
export function removeLastColumn(t: Table): number {
  if (t.columns.length <= 1) return 0;
  const last = t.columns.length - 1;
  const placed = layoutCells(t);
  // Walk backwards so splicing doesn't shift indexes we still need.
  for (const p of [...placed].reverse()) {
    if (p.col + p.colSpan - 1 < last) continue;
    const row = t.rows[p.row];
    if (p.col === last) row.cells.splice(p.index, 1);
    else {
      const span = p.colSpan - 1;
      if (span > 1) row.cells[p.index].colSpan = span;
      else delete row.cells[p.index].colSpan;
    }
  }
  return t.columns.pop()!;
}
