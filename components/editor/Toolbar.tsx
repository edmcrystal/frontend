"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignStartHorizontal,
  AlignStartVertical,
  ArrowDown,
  ArrowUp,
  BringToFront,
  ChartColumn,
  Copy,
  Group,
  Image as ImageIcon,
  Redo2,
  ScanEye,
  SendToBack,
  Shapes,
  Table,
  Trash2,
  Type,
  Undo2,
  Ungroup,
} from "lucide-react";
import { useEditor } from "@/lib/deck/store";
import {
  alignElements,
  deleteElements,
  distributeElements,
  duplicateElements,
  groupElements,
  insertElements,
  reorderElements,
  ungroupElements,
  type AlignMode,
} from "@/lib/deck/commands";
import { createChart, createImage, createShape, createTable, createTextBox, imageFileToAsset } from "@/lib/deck/factories";
import type { Element, PresetShape } from "@/lib/deck/schema";
import { LOW_CONFIDENCE } from "./renderers/ElementView";
import ui from "./ui.module.css";

const SHAPES: { preset: PresetShape; label: string }[] = [
  { preset: "rect", label: "Rectangle" },
  { preset: "round-rect", label: "Rounded rectangle" },
  { preset: "ellipse", label: "Ellipse" },
  { preset: "triangle", label: "Triangle" },
  { preset: "diamond", label: "Diamond" },
  { preset: "chevron", label: "Chevron" },
  { preset: "arrow-right", label: "Arrow" },
  { preset: "line", label: "Line" },
];

function Menu({ label, icon, children }: { label: string; icon: ReactNode; children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div className={ui.menu} ref={ref}>
      <button type="button" className={ui.btn} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {icon}
        {label}
      </button>
      {open && (
        <div className={ui.menuPanel} role="menu">
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

function IconButton({ label, onClick, disabled, children, pressed }: { label: string; onClick: () => void; disabled?: boolean; children: ReactNode; pressed?: boolean }) {
  return (
    <button type="button" className={ui.btn} title={label} aria-label={label} onClick={onClick} disabled={disabled} aria-pressed={pressed}>
      {children}
    </button>
  );
}

function countLowConfidence(elements: Element[]): number {
  return elements.reduce((n, el) => {
    const c = el.provenance?.confidence;
    return n + (c !== undefined && c < LOW_CONFIDENCE ? 1 : 0) + (el.type === "group" ? countLowConfidence(el.children) : 0);
  }, 0);
}

export function Toolbar({ saveStatus }: { saveStatus: ReactNode }) {
  const deck = useEditor((s) => s.deck)!;
  const slideId = useEditor((s) => s.slideId)!;
  const selection = useEditor((s) => s.selection);
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);
  const review = useEditor((s) => s.review);
  const { commit, undo, redo, select, setEditing, setReview } = useEditor.getState();
  const fileRef = useRef<HTMLInputElement>(null);
  const insertCount = useRef(0);

  const slide = deck.slides.find((s) => s.id === slideId);
  const topSelected = slide ? slide.elements.filter((e) => selection.includes(e.id)) : [];
  const hasGroup = topSelected.some((e) => e.type === "group");
  const flagged = deck.slides.reduce((n, s) => n + countLowConfidence(s.elements), 0);

  const insert = (el: Element, edit = false) => {
    const ids = commit((d) => insertElements(d, slideId, [el]));
    select(ids);
    if (edit) setEditing(el.id);
  };
  const cascade = () => (insertCount.current++ % 6) * 12;

  const onImage = async (file: File | undefined) => {
    if (!file) return;
    const asset = await imageFileToAsset(file);
    const el = createImage(useEditor.getState().deck!, asset, cascade());
    const ids = commit((d) => {
      d.assets[asset.id] = asset;
      return insertElements(d, slideId, [el]);
    });
    select(ids);
  };

  const align = (mode: AlignMode) => commit((d) => alignElements(d, slideId, selection, mode));
  const none = selection.length === 0;

  return (
    <div className={ui.bar} role="toolbar" aria-label="Editor">
      <Link href="/decks" className={ui.btn} title="All decks">
        ←
      </Link>
      <strong style={{ fontSize: 14, margin: "0 8px", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{deck.title}</strong>
      <span className={ui.sep} />
      <IconButton label="Undo (Ctrl+Z)" onClick={undo} disabled={!canUndo}>
        <Undo2 size={16} />
      </IconButton>
      <IconButton label="Redo (Ctrl+Shift+Z)" onClick={redo} disabled={!canRedo}>
        <Redo2 size={16} />
      </IconButton>
      <span className={ui.sep} />
      <button type="button" className={ui.btn} onClick={() => insert(createTextBox(deck, cascade()), true)}>
        <Type size={16} />
        Text
      </button>
      <Menu label="Shape" icon={<Shapes size={16} />}>
        {(close) =>
          SHAPES.map((s) => (
            <button
              key={s.preset}
              type="button"
              role="menuitem"
              className={ui.btn}
              onClick={() => {
                insert(createShape(deck, s.preset, cascade()));
                close();
              }}
            >
              {s.label}
            </button>
          ))
        }
      </Menu>
      <button type="button" className={ui.btn} onClick={() => fileRef.current?.click()}>
        <ImageIcon size={16} />
        Image
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          void onImage(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <button type="button" className={ui.btn} onClick={() => insert(createTable(deck, 3, 3, cascade()))}>
        <Table size={16} />
        Table
      </button>
      <button type="button" className={ui.btn} onClick={() => insert(createChart(deck, cascade()))}>
        <ChartColumn size={16} />
        Chart
      </button>
      <span className={ui.sep} />
      <IconButton label="Bring forward (Ctrl+])" disabled={none} onClick={() => commit((d) => reorderElements(d, slideId, selection, "forward"))}>
        <ArrowUp size={16} />
      </IconButton>
      <IconButton label="Send backward (Ctrl+[)" disabled={none} onClick={() => commit((d) => reorderElements(d, slideId, selection, "backward"))}>
        <ArrowDown size={16} />
      </IconButton>
      <IconButton label="Bring to front (Ctrl+Shift+])" disabled={none} onClick={() => commit((d) => reorderElements(d, slideId, selection, "front"))}>
        <BringToFront size={16} />
      </IconButton>
      <IconButton label="Send to back (Ctrl+Shift+[)" disabled={none} onClick={() => commit((d) => reorderElements(d, slideId, selection, "back"))}>
        <SendToBack size={16} />
      </IconButton>
      <Menu label="Align" icon={<AlignCenterVertical size={16} />}>
        {(close) => {
          const item = (label: string, icon: ReactNode, fn: () => void, disabled = false) => (
            <button
              type="button"
              role="menuitem"
              className={ui.btn}
              disabled={disabled || none}
              onClick={() => {
                fn();
                close();
              }}
            >
              {icon}
              {label}
            </button>
          );
          return (
            <>
              {item("Left", <AlignStartVertical size={16} />, () => align("left"))}
              {item("Center", <AlignCenterVertical size={16} />, () => align("hcenter"))}
              {item("Right", <AlignEndVertical size={16} />, () => align("right"))}
              {item("Top", <AlignStartHorizontal size={16} />, () => align("top"))}
              {item("Middle", <AlignCenterHorizontal size={16} />, () => align("vcenter"))}
              {item("Bottom", <AlignEndHorizontal size={16} />, () => align("bottom"))}
              {item("Distribute horizontally", <span style={{ width: 16 }}>⇹</span>, () => commit((d) => distributeElements(d, slideId, selection, "x")), selection.length < 3)}
              {item("Distribute vertically", <span style={{ width: 16 }}>⇳</span>, () => commit((d) => distributeElements(d, slideId, selection, "y")), selection.length < 3)}
              <span className={ui.note} style={{ padding: "4px 7px" }}>
                One item aligns to the slide; several align to each other.
              </span>
            </>
          );
        }}
      </Menu>
      <IconButton
        label="Group (Ctrl+G)"
        disabled={topSelected.length < 2}
        onClick={() => {
          const id = commit((d) => groupElements(d, slideId, selection));
          if (id) select([id]);
        }}
      >
        <Group size={16} />
      </IconButton>
      <IconButton label="Ungroup (Ctrl+Shift+G)" disabled={!hasGroup} onClick={() => select(commit((d) => ungroupElements(d, slideId, selection)))}>
        <Ungroup size={16} />
      </IconButton>
      <IconButton label="Duplicate (Ctrl+D)" disabled={none} onClick={() => select(commit((d) => duplicateElements(d, slideId, selection)))}>
        <Copy size={16} />
      </IconButton>
      <IconButton label="Delete (Del)" disabled={none} onClick={() => commit((d) => deleteElements(d, slideId, selection))}>
        <Trash2 size={16} />
      </IconButton>
      <span style={{ flex: 1 }} />
      <button
        type="button"
        className={ui.btn}
        aria-pressed={review}
        title="Highlight elements the import was unsure about"
        onClick={() => setReview(!review)}
      >
        <ScanEye size={16} />
        Review{flagged ? ` (${flagged})` : ""}
      </button>
      <span className={ui.note} style={{ marginLeft: 8 }} aria-live="polite">
        {saveStatus}
      </span>
    </div>
  );
}
