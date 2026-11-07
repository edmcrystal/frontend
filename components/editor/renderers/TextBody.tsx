import type { CSSProperties } from "react";
import type { Paragraph, Run } from "@/lib/deck/schema";
import { bulletLabels } from "@/lib/deck/render-utils";

const LEVEL_INDENT = 27; // pt per outline level (PowerPoint default ~0.375in)
const DEFAULT_LINE_HEIGHT = 1.2;

type Props = {
  paragraphs: Paragraph[];
  padding?: [number, number, number, number];
  verticalAlign?: "top" | "middle" | "bottom";
};

const justify = { top: "flex-start", middle: "center", bottom: "flex-end" } as const;

function runStyle(run: Run): CSSProperties {
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
        return (
          <div
            key={i}
            style={{
              display: "flex",
              textAlign: p.align,
              justifyContent: label ? undefined : p.align === "center" ? "center" : p.align === "right" ? "flex-end" : undefined,
              paddingLeft: p.level * LEVEL_INDENT,
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
                style={{ ...(first ? runStyle(first) : {}), flex: "0 0 auto", minWidth: size * 1.1, color: bulletColor, fontWeight: 400, fontStyle: "normal", textDecoration: "none" }}
              >
                {label}
              </span>
            )}
            <span style={{ flex: "1 1 auto", textAlign: p.align }}>
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
            </span>
          </div>
        );
      })}
    </div>
  );
}
