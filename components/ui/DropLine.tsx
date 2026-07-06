// Insertion indicator for vertical drag-reorder lists. Collapsed to zero height
// when inactive; when active it expands to a 4px accent bar, so neighbouring
// items visibly part to reveal where the dragged item will land.
export function DropLine({ active }: { active: boolean }) {
  return (
    <div
      aria-hidden
      className={`overflow-hidden transition-all duration-100 ${active ? "h-1.5 my-1" : "h-0"}`}
    >
      <div className="h-1 rounded-full bg-accent mx-0.5" />
    </div>
  );
}
