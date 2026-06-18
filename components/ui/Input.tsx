"use client";

import { forwardRef, type InputHTMLAttributes } from "react";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className = "", ...props }, ref) {
    return (
      <input
        ref={ref}
        {...props}
        className={`w-full bg-panel text-text text-base px-3 py-2.5 rounded-lg border border-border placeholder:text-subtle/50 focus:outline-none focus:border-accent/60 transition-colors ${className}`}
      />
    );
  }
);
