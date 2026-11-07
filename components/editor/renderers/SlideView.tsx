import type { Deck, Slide } from "@/lib/deck/schema";
import { fillToCss } from "@/lib/deck/render-utils";
import { ElementView } from "./ElementView";

type Props = {
  deck: Deck;
  slide: Slide;
  /** Screen pixels per slide point. */
  scale: number;
  review?: boolean;
};

/**
 * Renders a slide on a fixed stage of deck.size points (1pt = 1 CSS px on the
 * stage), scaled with a CSS transform. Editor, thumbnails and (later) PDF
 * export all use this one renderer.
 */
export function SlideView({ deck, slide, scale, review }: Props) {
  const { width, height } = deck.size;
  return (
    <div style={{ width: width * scale, height: height * scale, overflow: "hidden", position: "relative" }}>
      <div
        data-slide-id={slide.id}
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width,
          height,
          transform: `scale(${scale})`,
          transformOrigin: "0 0",
          background: fillToCss(slide.background, deck.assets),
          overflow: "hidden",
        }}
      >
        {slide.elements.map((el) => (
          <ElementView key={el.id} el={el} deck={deck} review={review} />
        ))}
      </div>
    </div>
  );
}
