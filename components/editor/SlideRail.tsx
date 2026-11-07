"use client";

import { memo } from "react";
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Copy, Plus, Trash2 } from "lucide-react";
import type { Deck, Slide } from "@/lib/deck/schema";
import { useEditor } from "@/lib/deck/store";
import { addSlide, deleteSlide, duplicateSlide, moveSlide } from "@/lib/deck/commands";
import { SlideView } from "./renderers/SlideView";
import styles from "./EditorShell.module.css";
import ui from "./ui.module.css";

const THUMB_WIDTH = 150;

// Thumbnails only re-render when their slide (or the deck's assets/theme) changes.
const Thumb = memo(function Thumb({ deck, slide }: { deck: Deck; slide: Slide }) {
  return <SlideView deck={deck} slide={slide} scale={THUMB_WIDTH / deck.size.width} />;
});

function SortableThumb({ deck, slide, index, active }: { deck: Deck; slide: Slide; index: number; active: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: slide.id });
  const { setSlide, commit } = useEditor.getState();
  const canDelete = deck.slides.length > 1;
  return (
    <div
      ref={setNodeRef}
      className={styles.thumbRow}
      style={{ transform: CSS.Transform.toString(transform), transition, zIndex: isDragging ? 2 : undefined, opacity: isDragging ? 0.85 : 1 }}
    >
      <span className={styles.thumbIndex}>{index + 1}</span>
      <div className={styles.thumbWrap}>
        <button
          type="button"
          className={active ? `${styles.thumb} ${styles.thumbActive}` : styles.thumb}
          aria-label={`Slide ${index + 1}`}
          aria-current={active ? "true" : undefined}
          onClick={() => setSlide(slide.id)}
          {...attributes}
          {...listeners}
        >
          <Thumb deck={deck} slide={slide} />
        </button>
        {active && (
          <div className={styles.thumbActions}>
            <button type="button" className={ui.btn} title="Duplicate slide" aria-label="Duplicate slide" onClick={() => setSlide(commit((d) => duplicateSlide(d, slide.id)))}>
              <Copy size={14} />
            </button>
            <button
              type="button"
              className={ui.btn}
              title="Delete slide"
              aria-label="Delete slide"
              disabled={!canDelete}
              onClick={() => setSlide(commit((d) => deleteSlide(d, slide.id)))}
            >
              <Trash2 size={14} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export function SlideRail() {
  const deck = useEditor((s) => s.deck)!;
  const slideId = useEditor((s) => s.slideId);
  const { commit, setSlide } = useEditor.getState();
  const sensors = useSensors(
    // A small distance keeps plain clicks working as "select slide".
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const from = deck.slides.findIndex((s) => s.id === active.id);
    const to = deck.slides.findIndex((s) => s.id === over.id);
    commit((d) => moveSlide(d, from, to));
  };

  const activeIndex = deck.slides.findIndex((s) => s.id === slideId);

  return (
    <nav className={styles.rail} aria-label="Slides">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={deck.slides.map((s) => s.id)} strategy={verticalListSortingStrategy}>
          {deck.slides.map((s, i) => (
            <SortableThumb key={s.id} deck={deck} slide={s} index={i} active={s.id === slideId} />
          ))}
        </SortableContext>
      </DndContext>
      <button type="button" className={`${ui.btn} ${styles.addSlide}`} onClick={() => setSlide(commit((d) => addSlide(d, activeIndex + 1)))}>
        <Plus size={16} />
        New slide
      </button>
    </nav>
  );
}
