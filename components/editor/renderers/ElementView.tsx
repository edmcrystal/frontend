import type { ReactNode } from "react";
import type { Deck, Element } from "@/lib/deck/schema";
import { TextRenderer } from "./TextRenderer";
import { ImageRenderer } from "./ImageRenderer";
import { ShapeRenderer } from "./ShapeRenderer";
import { TableRenderer } from "./TableRenderer";
import { ChartRenderer } from "./ChartRenderer";
import { IconRenderer } from "./IconRenderer";

export const LOW_CONFIDENCE = 0.7;

/** Editor hooks: render a live text editor in place of the element's text. */
export type EditHooks = {
  editingId?: string | null;
  renderTextEditor?: (el: Element) => ReactNode;
};

type Props = { el: Element; deck: Deck; review?: boolean; depth?: number } & EditHooks;

/**
 * Positions one element and dispatches to its renderer.
 * Frames are in the parent's coordinate space: slide space at the top level,
 * group-local space (relative to the group's top-left) inside groups.
 * Rotation is around the element's center, as in PPTX.
 */
export function ElementView({ el, deck, review, depth = 0, editingId, renderTextEditor }: Props) {
  if (el.hidden) return null;
  const { x, y, w, h, rotation } = el.frame;
  const confidence = el.provenance?.confidence;
  const flagged = review && confidence !== undefined && confidence < LOW_CONFIDENCE;

  return (
    <div
      data-element-id={el.id}
      data-element-type={el.type}
      data-depth={depth}
      style={{
        position: "absolute",
        left: x,
        top: y,
        width: w,
        height: h,
        transform: rotation ? `rotate(${rotation}deg)` : undefined,
        opacity: el.opacity,
        outline: flagged ? "2px dashed #F97316" : undefined,
        outlineOffset: flagged ? 2 : undefined,
      }}
    >
      {renderBody(el, deck, { review, depth, editingId, renderTextEditor })}
      {flagged && (
        <span
          title={`Detected by ${el.provenance?.source} with ${Math.round(confidence! * 100)}% confidence — please check`}
          style={{
            position: "absolute",
            top: -12,
            right: -6,
            background: "#F97316",
            color: "#fff",
            fontSize: 10,
            fontFamily: "Arial, sans-serif",
            fontWeight: 700,
            padding: "1px 5px",
            borderRadius: 8,
            zIndex: 1,
          }}
        >
          {Math.round(confidence! * 100)}%
        </span>
      )}
    </div>
  );
}

function renderBody(el: Element, deck: Deck, opts: { review?: boolean; depth: number } & EditHooks) {
  const editor = opts.editingId === el.id ? opts.renderTextEditor?.(el) : undefined;
  switch (el.type) {
    case "text":
      return editor ? (
        <>
          <TextRenderer el={{ ...el, paragraphs: [] }} assets={deck.assets} />
          {editor}
        </>
      ) : (
        <TextRenderer el={el} assets={deck.assets} />
      );
    case "image":
      return <ImageRenderer el={el} assets={deck.assets} />;
    case "shape":
      return (
        <>
          <ShapeRenderer el={el} assets={deck.assets} hideText={!!editor} />
          {editor}
        </>
      );
    case "table":
      return <TableRenderer el={el} assets={deck.assets} />;
    case "chart":
      return <ChartRenderer el={el} theme={deck.theme} />;
    case "icon":
      return <IconRenderer el={el} />;
    case "group":
      return el.children.map((child) => (
        <ElementView
          key={child.id}
          el={child}
          deck={deck}
          review={opts.review}
          depth={opts.depth + 1}
          editingId={opts.editingId}
          renderTextEditor={opts.renderTextEditor}
        />
      ));
  }
}
