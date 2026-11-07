import type { IconElement } from "@/lib/deck/schema";
import { iconDataUri } from "@/lib/deck/render-utils";

export function IconRenderer({ el }: { el: IconElement }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- data URI keeps untrusted SVG inert
    <img
      src={iconDataUri(el.svg, el.viewBox, el.color)}
      alt={el.name ?? el.iconId ?? ""}
      draggable={false}
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
    />
  );
}
