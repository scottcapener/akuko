"use client";

import { useEffect, useState } from "react";

// The one avatar primitive for the whole app. Renders an uploaded picture when
// there is one, otherwise initials-in-a-circle derived from the name. Built
// here so Shared With You (comment cards, recipient chips, recent-partner
// chips — see SHARED_WITH_YOU.md §Identity) reuses the identical component
// rather than reinventing the fallback.

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

interface AvatarProps {
  name: string;
  src?: string | null;
  size?: number; // px, defaults to a chip-sized 32
  className?: string;
}

export function Avatar({ name, src, size = 32, className = "" }: AvatarProps) {
  // Fall back to initials if the image fails (e.g. an expired signed URL that
  // wasn't re-minted). Reset whenever the src changes.
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [src]);

  const showImage = src && !broken;

  return (
    <div
      className={`relative flex-shrink-0 overflow-hidden rounded-full bg-elevated flex items-center justify-center select-none ${className}`}
      style={{ width: size, height: size }}
      aria-label={name || undefined}
    >
      {showImage ? (
        // Signed Storage URL — Next/Image isn't configured for the Supabase
        // host, so a plain <img> (matching how covers render elsewhere).
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={name}
          onError={() => setBroken(true)}
          className="w-full h-full object-cover"
        />
      ) : (
        <span
          className="font-medium text-subtle leading-none"
          style={{ fontSize: Math.round(size * 0.4) }}
        >
          {initials(name)}
        </span>
      )}
    </div>
  );
}
