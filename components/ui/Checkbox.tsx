"use client";

import type React from "react";

// A styled checkbox — a rounded box that fills with the accent and shows a check
// when on, replacing the raw native <input type="checkbox"> in the sharing /
// delete flows (Stage 8 / 8.3). The whole row (box + label) is the toggle.
export function Checkbox({
  checked,
  onChange,
  label,
  className = "",
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`flex items-start gap-2.5 w-full text-left cursor-pointer select-none ${className}`}
    >
      <span
        className={`mt-0.5 w-4 h-4 flex-shrink-0 rounded flex items-center justify-center border transition-colors ${
          checked
            ? "bg-accent border-accent text-on-accent"
            : "bg-transparent border-hover hover:border-subtle"
        }`}
      >
        {checked && (
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        )}
      </span>
      <span className="text-xs text-subtle leading-relaxed">{label}</span>
    </button>
  );
}
