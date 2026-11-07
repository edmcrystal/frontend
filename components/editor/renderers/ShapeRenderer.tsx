import { useId } from "react";
import type { Deck, ShapeElement } from "@/lib/deck/schema";
import { gradientVector, presetPath, strokeDashArray } from "@/lib/deck/render-utils";
import { TextBody } from "./TextBody";

export function ShapeRenderer({ el, assets }: { el: ShapeElement; assets: Deck["assets"] }) {
  const { w, h } = el.frame;
  const isLine = "preset" in el.geometry && el.geometry.preset === "line";
  const d = "preset" in el.geometry ? presetPath(el.geometry.preset, w, h) : el.geometry.path;
  const viewBox = "preset" in el.geometry ? `0 0 ${w} ${h}` : el.geometry.viewBox.join(" ");
  const paintId = `paint-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;

  let fill = "none";
  let defs = null;
  if (!isLine) {
    switch (el.fill.type) {
      case "solid":
        fill = el.fill.color;
        break;
      case "linear-gradient": {
        const v = gradientVector(el.fill.angle);
        fill = `url(#${paintId})`;
        defs = (
          <linearGradient id={paintId} {...v}>
            {el.fill.stops.map((s, i) => (
              <stop key={i} offset={s.offset} stopColor={s.color} />
            ))}
          </linearGradient>
        );
        break;
      }
      case "image": {
        const url = assets[el.fill.assetId]?.url;
        if (url) {
          fill = `url(#${paintId})`;
          defs = (
            <pattern id={paintId} patternUnits="userSpaceOnUse" width={w} height={h}>
              <image href={url} width={w} height={h} preserveAspectRatio={el.fill.fit === "contain" ? "xMidYMid meet" : el.fill.fit === "stretch" ? "none" : "xMidYMid slice"} />
            </pattern>
          );
        }
        break;
      }
    }
  }

  const stroke = el.stroke ?? (isLine ? { color: "#000000", width: 1, dash: "solid" as const } : undefined);

  return (
    <>
      <svg
        width={Math.max(w, 1)}
        height={Math.max(h, 1)}
        viewBox={viewBox}
        preserveAspectRatio="none"
        style={{ position: "absolute", inset: 0, overflow: "visible" }}
      >
        {defs && <defs>{defs}</defs>}
        <path
          d={d}
          fill={fill}
          stroke={stroke?.color ?? "none"}
          strokeWidth={stroke?.width ?? 0}
          strokeDasharray={stroke ? strokeDashArray(stroke.dash, stroke.width) : undefined}
          // Custom paths are stretched by preserveAspectRatio="none"; keep their stroke width true.
          vectorEffect={"path" in el.geometry ? "non-scaling-stroke" : undefined}
          strokeLinejoin="round"
        />
      </svg>
      {el.paragraphs && el.paragraphs.length > 0 && (
        <TextBody paragraphs={el.paragraphs} verticalAlign={el.verticalAlign} />
      )}
    </>
  );
}
