/**
 * Tiptap schema matching the deck's text model: paragraphs carry alignment,
 * outline level, bullet and spacing; runs carry bold/italic/underline/strike/
 * link and a textStyle (font, size, color, highlight, letter spacing).
 */
import { Extension, mergeAttributes, type Editor } from "@tiptap/core";
import Document from "@tiptap/extension-document";
import Paragraph from "@tiptap/extension-paragraph";
import Text from "@tiptap/extension-text";
import Bold from "@tiptap/extension-bold";
import Italic from "@tiptap/extension-italic";
import Underline from "@tiptap/extension-underline";
import Strike from "@tiptap/extension-strike";
import HardBreak from "@tiptap/extension-hard-break";
import Link from "@tiptap/extension-link";
import { BackgroundColor, Color, FontFamily, FontSize, TextStyle } from "@tiptap/extension-text-style";
import { UndoRedo } from "@tiptap/extensions";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";
import type { Bullet, Paragraph as DeckParagraph } from "@/lib/deck/schema";
import { DEFAULT_LINE_HEIGHT, LEVEL_INDENT, bulletIndent, bulletLabels } from "@/lib/deck/render-utils";
import type { RunStyle } from "@/lib/deck/text";

const MAX_LEVEL = 8;

const hidden = () => ({});

function firstRunStyle(node: PMNode): { size: number; font?: string; color?: string } {
  const defaults = node.attrs.runDefaults as RunStyle | null;
  let size = defaults?.size;
  let font = defaults?.font;
  let color = defaults?.color;
  const first = node.firstChild;
  const ts = first?.marks.find((m) => m.type.name === "textStyle");
  if (ts) {
    const n = parseFloat(ts.attrs.fontSize);
    if (Number.isFinite(n)) size = n;
    font = ts.attrs.fontFamily || font;
    color = ts.attrs.color || color;
  }
  return { size: size ?? 18, font, color };
}

const bulletsKey = new PluginKey("slideBullets");

/** Draws bullet labels (•, 1., a. …) as node decorations, numbered like the renderer. */
function bulletPlugin(fallbackSize: () => number) {
  const build = (doc: PMNode) => {
    const nodes: { node: PMNode; pos: number }[] = [];
    doc.forEach((node, pos) => {
      if (node.type.name === "paragraph") nodes.push({ node, pos });
    });
    const labels = bulletLabels(
      nodes.map(({ node }) => ({ level: node.attrs.level ?? 0, bullet: node.attrs.bullet ?? undefined, align: "left", runs: [] }) as DeckParagraph),
    );
    const decos = nodes.map(({ node, pos }, i) => {
      const style = firstRunStyle(node);
      const size = node.childCount ? style.size : ((node.attrs.runDefaults as RunStyle | null)?.size ?? fallbackSize());
      const lh = node.attrs.lineHeight ?? DEFAULT_LINE_HEIGHT;
      const label = labels[i];
      const bw = label ? bulletIndent(size) : 0;
      const bullet = node.attrs.bullet as Bullet | null;
      const bulletColor = (bullet?.type === "char" && bullet.color) || style.color || "currentColor";
      const css = [
        `padding-left:${(node.attrs.level ?? 0) * LEVEL_INDENT + bw}px`,
        `text-indent:${-bw}px`,
        `min-height:${size * lh}px`,
        `--bullet-w:${bw}px`,
        `--bullet-size:${size}px`,
        `--bullet-color:${bulletColor}`,
        style.font ? `--bullet-font:${JSON.stringify(style.font)}` : "",
      ]
        .filter(Boolean)
        .join(";");
      return Decoration.node(pos, pos + node.nodeSize, label ? { style: css, "data-label": label } : { style: css });
    });
    return DecorationSet.create(doc, decos);
  };
  return new Plugin({
    key: bulletsKey,
    state: {
      init: (_, state) => build(state.doc),
      apply: (tr, old) => (tr.docChanged ? build(tr.doc) : old),
    },
    props: {
      decorations(state) {
        return bulletsKey.getState(state);
      },
    },
  });
}

export function changeLevel(editor: Editor, delta: number): boolean {
  return editor.commands.command(({ state, tr, dispatch }) => {
    const { from, to } = state.selection;
    state.doc.nodesBetween(from, to, (node, pos) => {
      if (node.type.name !== "paragraph") return;
      const level = Math.max(0, Math.min(MAX_LEVEL, (node.attrs.level ?? 0) + delta));
      tr.setNodeMarkup(pos, undefined, { ...node.attrs, level });
      return false;
    });
    dispatch?.(tr);
    return true; // swallow Tab so focus stays in the text box
  });
}

export const SlideParagraph = Paragraph.extend<{ fallbackSize: () => number }>({
  addOptions() {
    return { ...this.parent?.(), fallbackSize: () => 18 };
  },
  addAttributes() {
    return {
      align: {
        default: "left",
        parseHTML: (el) => el.style.textAlign || "left",
        renderHTML: hidden,
      },
      level: { default: 0, renderHTML: hidden, parseHTML: () => 0 },
      bullet: { default: null, renderHTML: hidden, parseHTML: () => null },
      lineHeight: { default: null, renderHTML: hidden, parseHTML: () => null },
      spaceBefore: { default: null, renderHTML: hidden, parseHTML: () => null },
      spaceAfter: { default: null, renderHTML: hidden, parseHTML: () => null },
      runDefaults: { default: null, renderHTML: hidden, parseHTML: () => null },
    };
  },
  renderHTML({ node, HTMLAttributes }) {
    const a = node.attrs;
    const style = [
      `text-align:${a.align}`,
      `line-height:${a.lineHeight ?? DEFAULT_LINE_HEIGHT}`,
      a.spaceBefore != null ? `margin-top:${a.spaceBefore}px` : "",
      a.spaceAfter != null ? `margin-bottom:${a.spaceAfter}px` : "",
    ]
      .filter(Boolean)
      .join(";");
    return ["p", mergeAttributes(HTMLAttributes, { style }), 0];
  },
  addKeyboardShortcuts() {
    return {
      Tab: () => changeLevel(this.editor, 1),
      "Shift-Tab": () => changeLevel(this.editor, -1),
    };
  },
  addProseMirrorPlugins() {
    return [bulletPlugin(this.options.fallbackSize)];
  },
});

const LetterSpacing = Extension.create({
  name: "letterSpacing",
  addGlobalAttributes() {
    return [
      {
        types: ["textStyle"],
        attributes: {
          letterSpacing: {
            default: null,
            parseHTML: (el) => el.style.letterSpacing || null,
            renderHTML: (attrs) => (attrs.letterSpacing ? { style: `letter-spacing:${attrs.letterSpacing}` } : {}),
          },
        },
      },
    ];
  },
});

export function slideTextExtensions(fallbackSize: () => number) {
  return [
    Document,
    SlideParagraph.configure({ fallbackSize }),
    Text,
    Bold,
    Italic,
    Underline,
    Strike,
    HardBreak,
    Link.configure({ openOnClick: false, autolink: false, linkOnPaste: true }),
    TextStyle,
    FontFamily,
    FontSize,
    Color,
    BackgroundColor,
    LetterSpacing,
    UndoRedo,
  ];
}

/** Sets attributes on every paragraph touched by the selection. */
export function setParagraphAttrs(editor: Editor, attrs: Record<string, unknown>) {
  editor.chain().focus().updateAttributes("paragraph", attrs).run();
}
