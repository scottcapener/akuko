"use client";

import Image from "next/image";

// Book Info tag pill. Two states per Figma `Tag` (79:2676): Default (unselected —
// panel fill, muted text) and Selected (elevated fill, accent border, primary
// text). Used both in the Book Info tags row and inside the Book Tags modal.
export function Tag({
  label,
  selected = false,
  onClick,
  title,
}: {
  label: string;
  selected?: boolean;
  onClick?: () => void;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title ?? label}
      className={`inline-flex items-center h-8 px-3 rounded-full border text-body-m whitespace-nowrap transition-colors ${
        selected
          ? "bg-elevated border-accent text-text"
          : "bg-panel border-hover text-muted hover:text-text hover:border-accent/40"
      }`}
    >
      {label}
    </button>
  );
}

// The round "+" chip that opens the Book Tags modal, shown after the selected
// tags (Figma Tag "State=Manage", 32×32).
export function TagManageButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Manage tags"
      aria-label="Manage tags"
      className="inline-flex items-center justify-center h-8 w-8 rounded-full border border-hover bg-panel text-subtle hover:text-text hover:border-accent/40 transition-colors flex-shrink-0"
    >
      <Image src="/plus.svg" alt="" width={16} height={16} className="opacity-70" />
    </button>
  );
}

// Empty-state pill shown when a book has no tags yet (Figma Tag "State=Empty").
export function TagAddButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 h-8 pl-2.5 pr-3.5 rounded-full border border-hover bg-panel text-subtle hover:text-text hover:border-accent/40 transition-colors"
    >
      <Image src="/plus.svg" alt="" width={16} height={16} className="opacity-70" />
      <span className="text-body-m">Add tags</span>
    </button>
  );
}
