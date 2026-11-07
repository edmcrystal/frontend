import type { Deck, TableElement } from "@/lib/deck/schema";
import { fillToCss } from "@/lib/deck/render-utils";
import { TextBody } from "./TextBody";

export function TableRenderer({ el, assets }: { el: TableElement; assets: Deck["assets"] }) {
  const border = el.border ? `${el.border.width}px ${el.border.dash === "solid" ? "solid" : "dashed"} ${el.border.color}` : undefined;
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "grid",
        gridTemplateColumns: el.columns.map((c) => `${c}px`).join(" "),
        gridTemplateRows: el.rows.map((r) => `${r.height}px`).join(" "),
        borderCollapse: "collapse",
      }}
    >
      {el.rows.flatMap((row, ri) =>
        row.cells.map((cell, ci) => (
          <div
            key={`${ri}-${ci}`}
            style={{
              position: "relative",
              gridColumn: cell.colSpan ? `span ${cell.colSpan}` : undefined,
              gridRow: cell.rowSpan ? `span ${cell.rowSpan}` : undefined,
              background: fillToCss(cell.fill, assets),
              border,
              // Collapse shared borders.
              marginLeft: border && ci > 0 ? -(el.border?.width ?? 0) : undefined,
              marginTop: border && ri > 0 ? -(el.border?.width ?? 0) : undefined,
            }}
          >
            <TextBody paragraphs={cell.paragraphs} padding={[4, 6, 4, 6]} verticalAlign="middle" />
          </div>
        )),
      )}
    </div>
  );
}
