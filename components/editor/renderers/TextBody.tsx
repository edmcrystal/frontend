import type { CSSProperties } from "react";
import type { Paragraph, Run } from "@/lib/deck/schema";
import { DEFAULT_LINE_HEIGHT, LEVEL_INDENT, bulletIndent, bulletLabels } from "@/lib/deck/render-utils";


type Props = {
  paragraphs: Paragraph[];
  padding?: [number, number, number, number];
  verticalAlign?: "top" | "middle" | "bottom";
};

const justify = { top: "flex-start", middle: "center", bottom: "flex-end" } as const;

export function runStyle(run: Run): CSSProperties {
  const decorations = [run.underline && "underline", run.strike && "line-through"].filter(Boolean);
  return {
    fontFamily: run.font,
    fontSize: run.size,
    color: run.color,
    fontWeight: run.bold ? 700 : 400,
    fontStyle: run.italic ? "italic" : "normal",
    textDecoration: decorations.length ? decorations.join(" ") : undefined,
    backgroundColor: run.highlight,
    letterSpacing: run.letterSpacing,
  };
}

/** Renders a paragraph/run tree. Shared by text boxes, shapes and table cells. */
export function TextBody({ paragraphs, padding = [7.2, 3.6, 7.2, 3.6], verticalAlign = "top" }: Props) {
  const labels = bulletLabels(paragraphs);
  const [t, r, b, l] = padding;
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        padding: `${t}px ${r}px ${b}px ${l}px`,
        display: "flex",
        flexDirection: "column",
        justifyContent: justify[verticalAlign],
        overflow: "visible",
        wordBreak: "break-word",
        whiteSpace: "pre-wrap",
      }}
    >
      {paragraphs.map((p, i) => {
        const first = p.runs[0];
        const size = first?.size ?? 18;
        const label = labels[i];
        const bulletColor = p.bullet?.type === "char" && p.bullet.color ? p.bullet.color : first?.color;
        const lineHeight = p.lineHeight ?? DEFAULT_LINE_HEIGHT;
        const bulletWidth = label ? bulletIndent(size) : 0;
        return (
          <div
            key={i}
            style={{
              textAlign: p.align,
              // Hanging indent: the bullet sits in the indent, wrapped lines align with the text.
              paddingLeft: p.level * LEVEL_INDENT + bulletWidth,
              textIndent: -bulletWidth,
              marginTop: p.spaceBefore,
              marginBottom: p.spaceAfter,
              lineHeight,
              // An empty paragraph still takes up one line.
              minHeight: size * lineHeight,
            }}
          >
            {label && (
              <span
                aria-hidden
                style={{ display: "inline-block", width: bulletWidth, textIndent: 0, fontFamily: first?.font, fontSize: size, color: bulletColor }}
              >
                {label}
              </span>
            )}
            {p.runs.map((run, j) =>
              run.link ? (
                <a key={j} href={run.link} target="_blank" rel="noreferrer noopener" style={runStyle(run)}>
                  {run.text}
                </a>
              ) : (
                <span key={j} style={runStyle(run)}>
                  {run.text}
                </span>
              ),
            )}
          </div>
        );
      })}
    </div>
  );
}
