import type { Deck, TextElement } from "@/lib/deck/schema";
import { fillToCss } from "@/lib/deck/render-utils";
import { TextBody } from "./TextBody";

export function TextRenderer({ el, assets }: { el: TextElement; assets: Deck["assets"] }) {
  return (
    <div style={{ position: "absolute", inset: 0, background: fillToCss(el.fill, assets) }}>
      <TextBody paragraphs={el.paragraphs} padding={el.padding} verticalAlign={el.verticalAlign} />
    </div>
  );
}
