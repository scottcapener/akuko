import { type LabelHTMLAttributes } from "react";

interface LabelProps extends LabelHTMLAttributes<HTMLLabelElement> {
  children: React.ReactNode;
}

export function Label({ children, className = "", ...props }: LabelProps) {
  return (
    <label
      className={`block text-[11px] font-medium tracking-wide uppercase text-subtle mb-1.5 ${className}`}
      {...props}
    >
      {children}
    </label>
  );
}
