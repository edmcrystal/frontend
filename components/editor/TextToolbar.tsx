"use client";

import type { Editor } from "@tiptap/core";
import { useEditorState } from "@tiptap/react";
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Bold,
  Indent,
  Italic,
  List,
  ListOrdered,
  Minus,
  Outdent,
  Plus,
  Strikethrough,
  Underline,
} from "lucide-react";
import type { Bullet, Element, Paragraph, Run } from "@/lib/deck/schema";
import { useEditor } from "@/lib/deck/store";
import { applyParagraphStyle, applyRunStyle, locate } from "@/lib/deck/commands";
import { changeLevel, setParagraphAttrs } from "@/lib/editor/tiptap";
import { toHexColor } from "@/lib/deck/text";
import ui from "./ui.module.css";

export const FONTS = ["Arial", "Helvetica", "Verdana", "Tahoma", "Trebuchet MS", "Georgia", "Times New Roman", "Garamond", "Courier New"];
const SIZES = [10, 12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 48, 54, 60, 72, 96];

const DISC: Bullet = { type: "char", char: "•" };
const NUMBERED: Bullet = { type: "number", format: "arabic-period", startAt: 1 };

type TextState = {
  font: string;
  size: number;
  color: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  align: Paragraph["align"];
  bullet: Bullet["type"] | null;
};

type TextActions = {
  setFont: (f: string) => void;
  setSize: (n: number) => void;
  stepSize: (dir: 1 | -1) => void;
  setColor: (c: string) => void;
  toggle: (mark: "bold" | "italic" | "underline" | "strike") => void;
  setAlign: (a: Paragraph["align"]) => void;
  setBullet: (b: Bullet | null) => void;
  indent?: (delta: 1 | -1) => void;
};

function nextSize(size: number, dir: 1 | -1) {
  return dir > 0 ? (SIZES.find((s) => s > size) ?? size + 8) : ([...SIZES].reverse().find((s) => s < size) ?? Math.max(1, size - 2));
}

function TextControls({ state, actions, disabled }: { state: TextState; actions: TextActions; disabled?: boolean }) {
  const fonts = FONTS.includes(state.font) ? FONTS : [state.font, ...FONTS];
  const markBtn = (mark: "bold" | "italic" | "underline" | "strike", Icon: typeof Bold, label: string) => (
    <button type="button" className={ui.btn} title={label} aria-label={label} aria-pressed={state[mark]} disabled={disabled} onMouseDown={(e) => e.preventDefault()} onClick={() => actions.toggle(mark)}>
      <Icon size={16} />
    </button>
  );
  const alignBtn = (a: Paragraph["align"], Icon: typeof Bold) => (
    <button type="button" className={ui.btn} title={`Align ${a}`} aria-label={`Align ${a}`} aria-pressed={state.align === a} disabled={disabled} onMouseDown={(e) => e.preventDefault()} onClick={() => actions.setAlign(a)}>
      <Icon size={16} />
    </button>
  );
  return (
    <div className={ui.bar} aria-label="Text formatting" role="toolbar">
      <select className={ui.select} aria-label="Font" value={state.font} disabled={disabled} onChange={(e) => actions.setFont(e.target.value)} style={{ width: 128 }}>
        {fonts.map((f) => (
          <option key={f} value={f} style={{ fontFamily: f }}>
            {f}
          </option>
        ))}
      </select>
      <button type="button" className={ui.btn} title="Smaller" aria-label="Decrease font size" disabled={disabled} onMouseDown={(e) => e.preventDefault()} onClick={() => actions.stepSize(-1)}>
        <Minus size={14} />
      </button>
      <input
        className={ui.input}
        type="number"
        aria-label="Font size"
        min={1}
        max={400}
        style={{ width: 52 }}
        disabled={disabled}
        value={Math.round(state.size * 10) / 10}
        onChange={(e) => {
          const n = parseFloat(e.target.value);
          if (n > 0) actions.setSize(n);
        }}
      />
      <button type="button" className={ui.btn} title="Larger" aria-label="Increase font size" disabled={disabled} onMouseDown={(e) => e.preventDefault()} onClick={() => actions.stepSize(1)}>
        <Plus size={14} />
      </button>
      <span className={ui.sep} />
      {markBtn("bold", Bold, "Bold")}
      {markBtn("italic", Italic, "Italic")}
      {markBtn("underline", Underline, "Underline")}
      {markBtn("strike", Strikethrough, "Strikethrough")}
      <input className={ui.color} type="color" aria-label="Text color" title="Text color" disabled={disabled} value={state.color.slice(0, 7)} onChange={(e) => actions.setColor(e.target.value.toUpperCase())} />
      <span className={ui.sep} />
      {alignBtn("left", AlignLeft)}
      {alignBtn("center", AlignCenter)}
      {alignBtn("right", AlignRight)}
      {alignBtn("justify", AlignJustify)}
      <span className={ui.sep} />
      <button type="button" className={ui.btn} title="Bullets" aria-label="Bullets" aria-pressed={state.bullet === "char"} disabled={disabled} onMouseDown={(e) => e.preventDefault()} onClick={() => actions.setBullet(state.bullet === "char" ? null : DISC)}>
        <List size={16} />
      </button>
      <button type="button" className={ui.btn} title="Numbering" aria-label="Numbering" aria-pressed={state.bullet === "number"} disabled={disabled} onMouseDown={(e) => e.preventDefault()} onClick={() => actions.setBullet(state.bullet === "number" ? null : NUMBERED)}>
        <ListOrdered size={16} />
      </button>
      <button type="button" className={ui.btn} title="Decrease indent (Shift+Tab)" aria-label="Decrease indent" disabled={disabled || !actions.indent} onMouseDown={(e) => e.preventDefault()} onClick={() => actions.indent?.(-1)}>
        <Outdent size={16} />
      </button>
      <button type="button" className={ui.btn} title="Increase indent (Tab)" aria-label="Increase indent" disabled={disabled || !actions.indent} onMouseDown={(e) => e.preventDefault()} onClick={() => actions.indent?.(1)}>
        <Indent size={16} />
      </button>
    </div>
  );
}

/** Formatting the live selection inside the text editor. */
function LiveTextControls({ editor, fallback }: { editor: Editor; fallback: TextState }) {
  const state = useEditorState({
    editor,
    selector: ({ editor: ed }): TextState => {
      const ts = ed.getAttributes("textStyle");
      const para = ed.getAttributes("paragraph");
      const size = parseFloat(ts.fontSize);
      return {
        font: (ts.fontFamily as string | undefined)?.replace(/^["']|["']$/g, "") || fallback.font,
        size: Number.isFinite(size) ? size : fallback.size,
        color: toHexColor(ts.color) ?? fallback.color,
        bold: ed.isActive("bold"),
        italic: ed.isActive("italic"),
        underline: ed.isActive("underline"),
        strike: ed.isActive("strike"),
        align: para.align ?? "left",
        bullet: (para.bullet as Bullet | null)?.type ?? null,
      };
    },
  });
  const chain = () => editor.chain().focus();
  const actions: TextActions = {
    setFont: (f) => chain().setFontFamily(f).run(),
    setSize: (n) => chain().setFontSize(`${n}px`).run(),
    stepSize: (dir) => chain().setFontSize(`${nextSize(state.size, dir)}px`).run(),
    setColor: (c) => chain().setColor(c).run(),
    toggle: (m) => {
      const c = chain();
      (m === "bold" ? c.toggleBold() : m === "italic" ? c.toggleItalic() : m === "underline" ? c.toggleUnderline() : c.toggleStrike()).run();
    },
    setAlign: (align) => setParagraphAttrs(editor, { align }),
    setBullet: (bullet) => setParagraphAttrs(editor, { bullet }),
    indent: (delta) => {
      editor.commands.focus();
      changeLevel(editor, delta);
    },
  };
  return <TextControls state={state} actions={actions} />;
}

function firstRun(el: Element): { run?: Run; para?: Paragraph } {
  const pick = (ps?: Paragraph[]) => {
    const para = ps?.find((p) => p.runs.length) ?? ps?.[0];
    return { run: para?.runs[0], para };
  };
  if (el.type === "text") return pick(el.paragraphs);
  if (el.type === "shape") return pick(el.paragraphs);
  if (el.type === "table") return pick(el.rows[0]?.cells[0]?.paragraphs);
  if (el.type === "group") {
    for (const c of el.children) {
      const r = firstRun(c);
      if (r.run) return r;
    }
  }
  return {};
}

/** Formatting toolbar: targets the text selection while editing, else every run of the selected elements. */
export function TextToolbar() {
  const textEditor = useEditor((s) => s.textEditor);
  const deck = useEditor((s) => s.deck);
  const slideId = useEditor((s) => s.slideId);
  const selection = useEditor((s) => s.selection);
  const commit = useEditor((s) => s.commit);

  const slide = deck?.slides.find((s) => s.id === slideId);
  const els = slide ? selection.map((id) => locate(slide.elements, id)?.el).filter((e): e is Element => !!e) : [];
  const withText = els.filter((el) => firstRun(el).run);
  const { run, para } = withText[0] ? firstRun(withText[0]) : {};
  const state: TextState = {
    font: run?.font ?? deck?.theme.fonts.body ?? "Arial",
    size: run?.size ?? 18,
    color: run?.color ?? deck?.theme.colors.text ?? "#000000",
    bold: !!run?.bold,
    italic: !!run?.italic,
    underline: !!run?.underline,
    strike: !!run?.strike,
    align: para?.align ?? "left",
    bullet: para?.bullet?.type ?? null,
  };

  if (textEditor) return <LiveTextControls editor={textEditor} fallback={state} />;

  const ids = withText.map((e) => e.id);
  const key = `format-${ids.join(",")}`;
  const runs = (patch: Parameters<typeof applyRunStyle>[3], k?: string) =>
    slideId && commit((d) => applyRunStyle(d, slideId, ids, patch), k ? { key: `${key}-${k}` } : undefined);
  const paras = (patch: Parameters<typeof applyParagraphStyle>[3]) => slideId && commit((d) => applyParagraphStyle(d, slideId, ids, patch));
  const actions: TextActions = {
    setFont: (font) => runs({ font }),
    setSize: (size) => runs({ size }, "size"),
    stepSize: (dir) => runs((r) => ({ size: nextSize(r.size, dir) })),
    setColor: (color) => runs({ color }, "color"),
    toggle: (m) => runs({ [m]: !state[m] }),
    setAlign: (align) => paras({ align }),
    setBullet: (bullet) => paras({ bullet: bullet ?? undefined }),
  };
  return <TextControls state={state} actions={actions} disabled={ids.length === 0} />;
}
