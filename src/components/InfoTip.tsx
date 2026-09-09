"use client";

import { useEffect, useRef, useState } from "react";

// A small circled "i" that toggles a plain-language explanation on click.
// Click-to-toggle (not hover) so it works on touch. Closes on outside click or
// Escape. `align` controls which way the popover opens to avoid edge overflow.
export default function InfoTip({
  label,
  children,
  align = "left",
  tone = "auto",
}: {
  label?: string;
  children: React.ReactNode;
  align?: "left" | "right";
  tone?: "auto" | "light" | "dark";
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Icon colour: on dark surfaces pass tone="dark".
  const iconClass =
    tone === "dark"
      ? "border-white/40 text-white/60 hover:text-white hover:border-white/70"
      : "border-gbx-muted/50 text-gbx-muted hover:text-gbx-teal hover:border-gbx-teal";

  return (
    <span ref={ref} className="relative inline-flex align-middle">
      <button
        type="button"
        aria-label={label ? `About ${label}` : "More information"}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        className={`inline-flex items-center justify-center w-4 h-4 rounded-full border text-[10px] font-body leading-none transition-colors ${iconClass}`}
      >
        i
      </button>
      {open && (
        <span
          role="tooltip"
          className={`absolute z-50 top-6 ${
            align === "right" ? "right-0" : "left-0"
          } w-64 max-w-[80vw] bg-white text-gbx-charcoal border border-gbx-border shadow-lg p-3 text-[12px] leading-relaxed font-body normal-case tracking-normal text-left`}
        >
          {label && (
            <span className="block text-[10px] uppercase tracking-[0.12em] font-medium text-gbx-teal mb-1">
              {label}
            </span>
          )}
          {children}
        </span>
      )}
    </span>
  );
}
