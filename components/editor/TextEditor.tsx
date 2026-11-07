"use client";

import { useEffect, useRef } from "react";
import { EditorContent, useEditor as useTiptap } from "@tiptap/react";
import type { ShapeElement, TextElement, Theme } from "@/lib/deck/schema";
import { setParagraphs } from "@/lib/deck/commands";
import { useEditor } from "@/lib/deck/store";
import { defaultRunStyle, docToParagraphs, paragraphsToDoc, type PMNode } from "@/lib/deck/text";
import { slideTextExtensions } from "@/lib/editor/tiptap";
import styles from "./TextEditor.module.css";

type Props = {
  el: TextElement | ShapeElement;
  slideId: string;
  theme: Theme;
  /** Client coordinates of the double-click, to place the caret there. Otherwise all text is selected. */
  caret?: { x: number; y: number } | null;
};

const justify = { top: "flex-start", middle: "center", bottom: "flex-end" } as const;

/**
 * Edits an element's text in place. Every change is committed to the deck
 * (one undo step per burst of typing) so thumbnails stay live.
 */
export function TextEditor({ el, slideId, theme, caret }: Props) {
  const commit = useEditor((s) => s.commit);
  const setTextEditor = useEditor((s) => s.setTextEditor);
  const setEditing = useEditor((s) => s.setEditing);

  // Captured once per editing session.
  const session = useRef({
    key: `text-${el.id}-${Date.now()}`,
    fallback: defaultRunStyle(el.paragraphs, { font: theme.fonts.body, size: 18, color: theme.colors.text }),
    caret,
  });
  const { fallback } = session.current;

  const editor = useTiptap({
    extensions: slideTextExtensions(() => session.current.fallback.size),
    content: paragraphsToDoc(el.paragraphs ?? []),
    immediatelyRender: false,
    editorProps: {
      attributes: { class: styles.prose, "data-text-editor": "true", spellcheck: "true" },
      handleKeyDown: (_view, event) => {
        if (event.key === "Escape") {
          setEditing(null);
          return true;
        }
        return false;
      },
    },
    onCreate: ({ editor }) => {
      const point = session.current.caret;
      const pos = point ? editor.view.posAtCoords({ left: point.x, top: point.y }) : null;
      if (pos) editor.chain().focus().setTextSelection(pos.pos).run();
      else editor.commands.focus("all");
    },
    onUpdate: ({ editor }) => {
      const paragraphs = docToParagraphs(editor.getJSON() as PMNode, session.current.fallback);
      commit((d) => setParagraphs(d, slideId, el.id, paragraphs), { key: session.current.key });
    },
  });

  useEffect(() => {
    setTextEditor(editor);
    return () => setTextEditor(null);
  }, [editor, setTextEditor]);

  const padding = el.type === "text" ? el.padding : [7.2, 3.6, 7.2, 3.6];
  return (
    <div
      className={styles.box}
      data-text-editor="true"
      style={{
        padding: padding.map((p) => `${p}px`).join(" "),
        justifyContent: justify[el.verticalAlign],
        fontFamily: fallback.font,
        fontSize: fallback.size,
        color: fallback.color,
      }}
    >
      <EditorContent editor={editor} />
    </div>
  );
}
