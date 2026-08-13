// Notification badge (SHARED_WITH_YOU.md §6) — the Figma "Badge" component with
// its two variants. A `dot` is a bare 6px presence marker (used on collapsed
// panel icons and the account launcher); a count renders the 16×15 accent pill
// (used on the account-menu "Shared" row and the editor Comments-tab icon).
// Counts above 9 read as "9+". Placement (absolute corner offsets) is the
// caller's job — this only draws the mark.

const DOT = "block w-1.5 h-1.5 rounded-full bg-accent";
const PILL =
  "inline-flex items-center justify-center min-w-4 h-[15px] px-1 rounded-full bg-accent text-on-accent text-[9px] font-medium leading-none tabular-nums";

export function Badge({
  count = 0,
  dot = false,
  className = "",
}: {
  count?: number;
  dot?: boolean;
  className?: string;
}) {
  if (dot) return <span aria-hidden className={`${DOT} ${className}`} />;
  if (count <= 0) return null;
  return (
    <span role="status" aria-label={`${count} unread`} className={`${PILL} ${className}`}>
      {count > 9 ? "9+" : count}
    </span>
  );
}
