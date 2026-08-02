"use client";

import { useMemo, useRef, useState } from "react";
import { Modal } from "@/components/ui";
import { Tag } from "@/components/Tag";
import { BOOK_TAGS } from "@/lib/bookTags";

// The Book Tags picker (Figma "Book Info - Tag Selection", 172:5294): a header
// with a Done button, a type-to-filter field, and a scrollable, wrapped grid of
// tags. Selected tags sort to the front so the current selection is always in
// view; clicking a tag toggles it live (no separate save step — Done just
// closes).
export function BookTagsModal({
  selectedIds,
  onToggle,
  onClose,
}: {
  selectedIds: string[];
  onToggle: (tagId: string) => void;
  onClose: () => void;
}) {
  const [filter, setFilter] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const matches = q ? BOOK_TAGS.filter((t) => t.label.toLowerCase().includes(q)) : BOOK_TAGS;
    // Selected first (each group keeps the source taxonomy order).
    return [...matches].sort((a, b) => {
      const sa = selected.has(a.id) ? 0 : 1;
      const sb = selected.has(b.id) ? 0 : 1;
      return sa - sb;
    });
  }, [filter, selected]);

  return (
    <Modal onClose={onClose} maxWidth="max-w-[536px]" backdrop="medium">
      <div className="flex flex-col max-h-[80vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-8 pt-8 pb-4">
          <h2 className="text-heading-l text-text">Book tags</h2>
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-accent text-text text-sm font-semibold tracking-wide hover:bg-accent-hi transition-colors"
          >
            Done
          </button>
        </div>

        {/* Filter */}
        <div className="px-8">
          <div className="flex items-center gap-2 h-8 px-3 rounded-lg bg-elevated border border-border-subtle focus-within:border-accent/60 transition-colors">
            <svg className="w-4 h-4 text-subtle flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11a6 6 0 11-12 0 6 6 0 0112 0z" />
            </svg>
            <input
              ref={inputRef}
              autoFocus
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter"
              autoComplete="off"
              className="flex-1 min-w-0 bg-transparent text-text text-body-m placeholder:text-subtle focus:outline-none"
            />
            {filter && (
              <button
                onClick={() => { setFilter(""); inputRef.current?.focus(); }}
                aria-label="Clear filter"
                className="text-subtle hover:text-text transition-colors flex-shrink-0"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        </div>

        {/* Tag grid */}
        <div className="flex flex-wrap gap-2 px-8 py-6 overflow-y-auto">
          {visible.length === 0 ? (
            <p className="text-body-m text-subtle py-4">No tags match “{filter}”.</p>
          ) : (
            visible.map((t) => (
              <Tag
                key={t.id}
                label={t.label}
                selected={selected.has(t.id)}
                onClick={() => onToggle(t.id)}
              />
            ))
          )}
        </div>
      </div>
    </Modal>
  );
}
