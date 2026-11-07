import type { Deck, ImageElement } from "@/lib/deck/schema";

export function ImageRenderer({ el, assets }: { el: ImageElement; assets: Deck["assets"] }) {
  const url = assets[el.assetId]?.url;
  const radius = el.mask === "ellipse" ? "50%" : el.mask === "rounded" ? Math.min(el.frame.w, el.frame.h) * 0.08 : 0;
  if (!url) {
    return (
      <div
        title={`Missing asset ${el.assetId}`}
        style={{ position: "absolute", inset: 0, borderRadius: radius, background: "repeating-linear-gradient(45deg,#e5e7eb 0 8px,#f3f4f6 8px 16px)" }}
      />
    );
  }
  const { l = 0, t = 0, r = 0, b = 0 } = el.crop ?? {};
  const visibleW = Math.max(1 - l - r, 0.01);
  const visibleH = Math.max(1 - t - b, 0.01);
  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden", borderRadius: radius }}>
      {/* eslint-disable-next-line @next/next/no-img-element -- assets are arbitrary user/import URLs */}
      <img
        src={url}
        alt={el.alt ?? ""}
        draggable={false}
        style={{
          position: "absolute",
          width: `${100 / visibleW}%`,
          height: `${100 / visibleH}%`,
          left: `${(-l / visibleW) * 100}%`,
          top: `${(-t / visibleH) * 100}%`,
          maxWidth: "none",
        }}
      />
    </div>
  );
}
