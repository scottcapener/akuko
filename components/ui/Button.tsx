import { type ButtonHTMLAttributes } from "react";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost";
  loading?: boolean;
}

const variants: Record<NonNullable<ButtonProps["variant"]>, string> = {
  primary:
    "w-full py-2.5 rounded-lg bg-accent text-text text-sm font-semibold tracking-wide hover:bg-accent-hi disabled:opacity-50 transition-colors",
  secondary:
    "px-4 py-2 rounded-lg bg-panel border border-border text-text text-xs font-medium hover:border-accent/40 disabled:opacity-50 transition-colors",
  ghost:
    "text-xs text-subtle/60 hover:text-subtle transition-colors",
};

export function Button({
  variant = "primary",
  loading,
  children,
  className = "",
  disabled,
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      disabled={loading || disabled}
      className={`${variants[variant]} ${className}`.trim()}
    >
      {loading ? "Please wait…" : children}
    </button>
  );
}
