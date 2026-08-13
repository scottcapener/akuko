"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { ensureDevSession } from "@/lib/ensureDevSession";
import { useUnread } from "@/lib/useUnread";
import { Badge } from "@/components/ui/Badge";
import * as db from "@/lib/db";
import type { BookSummary } from "@/lib/db";

// ── Inline icons ────────────────────────────────────────────────────────────
// Authored from assets/nav_panel_icons but redrawn with `currentColor` so they
// track the theme (the source SVGs bake in a mid-grey that wouldn't adapt to
// light mode). All share the 20×20 line grid; the panel-toggle uses 24×24.

type IconProps = { className?: string };

export function PanelToggleIcon({ className }: IconProps) {
  return (
    <svg className={className} width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 3H5C3.89543 3 3 3.89543 3 5V19C3 20.1046 3.89543 21 5 21H19C20.1046 21 21 20.1046 21 19V5C21 3.89543 20.1046 3 19 3Z" />
      <path d="M12 3V21" />
    </svg>
  );
}

function BooksIcon({ className }: IconProps) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <path d="M3.33334 16.2501C3.33334 15.6975 3.55284 15.1676 3.94354 14.7769C4.33424 14.3862 4.86414 14.1667 5.41668 14.1667H16.6667" />
      <path d="M5.41668 1.66675H16.6667V18.3334H5.41668C4.86414 18.3334 4.33424 18.1139 3.94354 17.7232C3.55284 17.3325 3.33334 16.8026 3.33334 16.2501V3.75008C3.33334 3.19755 3.55284 2.66764 3.94354 2.27694C4.33424 1.88624 4.86414 1.66675 5.41668 1.66675Z" />
    </svg>
  );
}

function BackupsIcon({ className }: IconProps) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <path d="M16.6667 7.5H9.16667C8.24619 7.5 7.5 8.24619 7.5 9.16667V16.6667C7.5 17.5871 8.24619 18.3333 9.16667 18.3333H16.6667C17.5871 18.3333 18.3333 17.5871 18.3333 16.6667V9.16667C18.3333 8.24619 17.5871 7.5 16.6667 7.5Z" />
      <path d="M4.16666 12.5001H3.33332C2.8913 12.5001 2.46737 12.3245 2.15481 12.0119C1.84225 11.6994 1.66666 11.2754 1.66666 10.8334V3.33341C1.66666 2.89139 1.84225 2.46746 2.15481 2.1549C2.46737 1.84234 2.8913 1.66675 3.33332 1.66675H10.8333C11.2754 1.66675 11.6993 1.84234 12.0118 2.1549C12.3244 2.46746 12.5 2.89139 12.5 3.33341V4.16675" />
    </svg>
  );
}

function ExportIcon({ className }: IconProps) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.5 12.5V15.8333C17.5 16.2754 17.3244 16.6993 17.0118 17.0118C16.6993 17.3244 16.2754 17.5 15.8333 17.5H4.16667C3.72464 17.5 3.30072 17.3244 2.98816 17.0118C2.67559 16.6993 2.5 16.2754 2.5 15.8333V12.5" />
      <path d="M5.83334 8.33325L10 12.4999L14.1667 8.33325" />
      <path d="M10 12.5V2.5" />
    </svg>
  );
}

function SettingsIcon({ className }: IconProps) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <path d="M16.6667 5.83325H9.16669" />
      <path d="M11.6667 14.1667H4.16669" />
      <path d="M14.1667 16.6667C15.5474 16.6667 16.6667 15.5475 16.6667 14.1667C16.6667 12.786 15.5474 11.6667 14.1667 11.6667C12.786 11.6667 11.6667 12.786 11.6667 14.1667C11.6667 15.5475 12.786 16.6667 14.1667 16.6667Z" />
      <path d="M5.83331 8.33325C7.21402 8.33325 8.33331 7.21396 8.33331 5.83325C8.33331 4.45254 7.21402 3.33325 5.83331 3.33325C4.4526 3.33325 3.33331 4.45254 3.33331 5.83325C3.33331 7.21396 4.4526 8.33325 5.83331 8.33325Z" />
    </svg>
  );
}

function AccountIcon({ className }: IconProps) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <path d="M15.8334 17.5V15.8333C15.8334 14.9493 15.4822 14.1014 14.857 13.4763C14.2319 12.8512 13.3841 12.5 12.5 12.5H7.50002C6.61597 12.5 5.76812 12.8512 5.143 13.4763C4.51788 14.1014 4.16669 14.9493 4.16669 15.8333V17.5" />
      <path d="M10 9.16667C11.841 9.16667 13.3334 7.67428 13.3334 5.83333C13.3334 3.99238 11.841 2.5 10 2.5C8.15907 2.5 6.66669 3.99238 6.66669 5.83333C6.66669 7.67428 8.15907 9.16667 10 9.16667Z" />
    </svg>
  );
}

// Speech bubble — the "Shared with you" conversation surface.
function SharedIcon({ className }: IconProps) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.5 9.58341C17.5029 10.6832 17.2459 11.7681 16.75 12.7501C16.162 13.9265 15.2581 14.916 14.1395 15.6077C13.021 16.2994 11.7319 16.666 10.4167 16.6667C9.31688 16.6697 8.23193 16.4126 7.25 15.9167L2.5 17.5001L4.08333 12.7501C3.58743 11.7681 3.33046 10.6832 3.33333 9.58341C3.33403 8.26819 3.7006 6.97906 4.39232 5.86054C5.08403 4.74201 6.07355 3.83808 7.25 3.25008C8.23193 2.75418 9.31688 2.49721 10.4167 2.50008H10.8333C12.5703 2.59591 14.2109 3.32914 15.4409 4.5591C16.6708 5.78907 17.4041 7.42975 17.5 9.16675V9.58341Z" />
    </svg>
  );
}

// Book-open placeholder when the active book has no cover (mirrors the Books grid).
function BookCoverPlaceholder() {
  return (
    <svg className="w-4 h-4 text-subtle opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.966 8.966 0 00-6 2.292m0-14.25v14.25" />
    </svg>
  );
}

// ── Nav item ────────────────────────────────────────────────────────────────

type NavItem = {
  href: string;
  label: string;
  Icon: (props: IconProps) => React.JSX.Element;
};

// Grouped exactly as in the Figma. "Shared with you" sits in its own section
// between the file group and Settings/Account (§3.1).
const PRIMARY: NavItem[] = [
  { href: "/books", label: "Books", Icon: BooksIcon },
  { href: "/backups", label: "Backups", Icon: BackupsIcon },
  { href: "/export", label: "Export", Icon: ExportIcon },
];
const SHARED: NavItem[] = [
  { href: "/shared", label: "Shared", Icon: SharedIcon },
];
const SECONDARY: NavItem[] = [
  { href: "/settings", label: "Settings", Icon: SettingsIcon },
  { href: "/account", label: "Account", Icon: AccountIcon },
];

function NavRow({ item, active, badge = 0, onNavigate }: { item: NavItem; active: boolean; badge?: number; onNavigate?: () => void }) {
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={`group flex items-center gap-3 px-3 py-2 rounded-lg transition-colors ${
        active ? "bg-hover" : "hover:bg-panel"
      }`}
    >
      <item.Icon className="w-5 h-5 flex-shrink-0 text-subtle" />
      <span className={`text-sm transition-colors ${active ? "text-text" : "text-muted group-hover:text-text"}`}>
        {item.label}
      </span>
      {badge > 0 && <Badge count={badge} className="ml-auto" />}
    </Link>
  );
}

// ── Panel ───────────────────────────────────────────────────────────────────

// The active book, cached at module scope so it survives NavPanel unmounts and
// is shared across mounts for the session. A return trip from the writer then
// renders "Return to Book" instantly from cache instead of re-showing the
// skeleton. `undefined` means never fetched (show the skeleton); a value or
// `null` means fetched. Reset only on a full page reload.
let cachedActiveBook: BookSummary | null | undefined;

interface Props {
  // Desktop collapse — mirrors the Book panel (LeftColumn): the enclosing column
  // animates its width while this body fades. The header's panel-toggle icon is
  // the collapse control. Omitted on mobile.
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  expandedWidth?: number;
  // Mobile drawer only — the header close (×) and closing the drawer after a tap.
  onClose?: () => void;
  onNavigate?: () => void;
}

export default function NavPanel({ collapsed, onToggleCollapse, expandedWidth, onClose, onNavigate }: Props) {
  const pathname = usePathname();
  const { total: unreadTotal } = useUnread();
  // Seed from the module cache so a revisit paints immediately; only the very
  // first fetch of the session shows the skeleton.
  const [book, setBook] = useState<BookSummary | null>(() => cachedActiveBook ?? null);
  const [loaded, setLoaded] = useState(() => cachedActiveBook !== undefined);
  const [coverBroken, setCoverBroken] = useState(false);

  // The active book drives "Return to Book" (its cover + title). Same source as
  // the Books grid; the active book is the most recently opened. This runs on
  // every mount to revalidate the cache — so a book switched in the writer is
  // reflected — but with a cached value already on screen the refresh is silent
  // (no skeleton). Until the first-ever fetch resolves, Return to Book shows a
  // skeleton rather than a placeholder title.
  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;
    (async () => {
      try {
        await ensureDevSession(supabase);
        const { data: { user } } = await supabase.auth.getUser();
        if (cancelled) return;
        if (user) {
          const books = await db.listBooks(user.id);
          if (cancelled) return;
          const active = books.find((b) => b.isActive) ?? books[0] ?? null;
          cachedActiveBook = active;
          setBook(active);
          setCoverBroken(false);
        }
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const showCover = book?.coverImage && !coverBroken;

  return (
    <div className="flex flex-col h-full bg-bg border-r border-border-subtle w-full">
      {/* Header — panel-toggle icon (collapse on desktop) + mobile close. Fixed
          h-16 so it lines up with the writer's panel headers. */}
      <div className="h-16 px-4 flex-shrink-0 flex items-center justify-between">
        {onToggleCollapse ? (
          <button
            onClick={onToggleCollapse}
            className="relative text-subtle hover:text-text transition-colors"
            title={collapsed ? "Expand navigation" : "Collapse navigation"}
            aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
          >
            <PanelToggleIcon className="w-6 h-6" />
            {/* When collapsed the Shared row is hidden, so surface unread here. */}
            {collapsed && unreadTotal > 0 && <Badge dot className="absolute -top-0.5 -right-0.5" />}
          </button>
        ) : (
          <PanelToggleIcon className="w-6 h-6 text-subtle" />
        )}
        {onClose && (
          <button
            onClick={onClose}
            className="text-subtle hover:text-text transition-colors md:hidden"
            aria-label="Close"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {/* Body — fixed to the expanded width and faded via `collapsed`, so the
          collapse reads as a pure fade while the enclosing column's width tweens
          (identical treatment to LeftColumn/RightColumn). */}
      <div
        className="flex flex-col flex-1 min-h-0"
        style={
          expandedWidth != null
            ? {
                width: expandedWidth,
                opacity: collapsed ? 0 : 1,
                transition: "opacity 200ms ease-in-out",
                pointerEvents: collapsed ? "none" : undefined,
              }
            : undefined
        }
      >
        <nav className="flex-1 min-h-0 overflow-y-auto px-3 pb-4 flex flex-col gap-1">
          {/* Return to Book — the way back to the writer. */}
          <Link
            href="/write"
            onClick={onNavigate}
            className="group flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-panel transition-colors"
            title="Return to book"
          >
            <svg className="w-4 h-4 flex-shrink-0 text-subtle" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            <span className={`h-8 aspect-[2/3] flex-shrink-0 rounded overflow-hidden bg-panel border border-border-subtle flex items-center justify-center ${loaded ? "" : "animate-pulse"}`}>
              {loaded && (showCover ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={book!.coverImage!}
                  alt=""
                  className="w-full h-full object-cover"
                  onError={() => setCoverBroken(true)}
                />
              ) : (
                <BookCoverPlaceholder />
              ))}
            </span>
            {/* Loaded and skeleton states share the same two line boxes (h-5 + h-4)
                so the row never changes height between them. */}
            {loaded ? (
              <span className="flex flex-col min-w-0">
                <span className="h-5 text-sm leading-5 text-text truncate">{book?.title || "Untitled"}</span>
                <span className="h-4 text-[11px] leading-4 text-subtle">Active</span>
              </span>
            ) : (
              <span className="flex flex-col min-w-0 animate-pulse" aria-hidden>
                <span className="h-5 flex items-center"><span className="block h-2.5 w-24 rounded bg-panel" /></span>
                <span className="h-4 flex items-center"><span className="block h-2 w-12 rounded bg-panel" /></span>
              </span>
            )}
          </Link>

          <div className="my-2 -mx-3 border-t border-border-subtle" />

          {PRIMARY.map((item) => (
            <NavRow key={item.href} item={item} active={pathname === item.href} onNavigate={onNavigate} />
          ))}

          <div className="my-2 -mx-3 border-t border-border-subtle" />

          {SHARED.map((item) => (
            <NavRow key={item.href} item={item} active={pathname.startsWith(item.href)} badge={unreadTotal} onNavigate={onNavigate} />
          ))}

          <div className="my-2 -mx-3 border-t border-border-subtle" />

          {SECONDARY.map((item) => (
            <NavRow key={item.href} item={item} active={pathname === item.href} onNavigate={onNavigate} />
          ))}
        </nav>

        {/* Wordmark — pinned to the bottom, matching the writer's Book panel. */}
        <div className="px-5 py-4 flex-shrink-0">
          <Image src="/logo-wordmark.svg" alt="Hot Cocoa" width={93} height={17} priority />
        </div>
      </div>
    </div>
  );
}
