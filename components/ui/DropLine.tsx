// Insertion indicator for vertical drag-reorder lists. Collapsed to zero height
// when inactive; when active it expands to a 4px accent bar, so neighbouring
// items visibly part to reveal where the dragged item will land. `className` on
// the outer wrapper lets a caller inset the line (e.g. scene lines align to the
// scene text). The height/margin transition animates the items parting.
export function DropLine({ active, className = "" }: { active: boolean; className?: string }) {
  return (
    <div
      aria-hidden
      className={`overflow-hidden transition-all duration-200 ease-out ${active ? "h-1.5 my-1" : "h-0"} ${className}`}
    >
      <div className="h-1 rounded-full bg-accent mx-0.5" />
    </div>
  );
}
