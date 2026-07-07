"use client";

import { useEffect, useId, useRef, useState } from "react";
import { CircleHelp } from "lucide-react";
import { cn } from "@/lib/cn";

type InfoTipProps = {
  children: React.ReactNode;
  className?: string;
};

export function InfoTip({ children, className }: InfoTipProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLSpanElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <span ref={containerRef} className={cn("group relative inline-flex", className)}>
      <button
        type="button"
        aria-label="More information"
        aria-describedby={id}
        onClick={() => setOpen((v) => !v)}
        className="flex h-5 w-5 items-center justify-center rounded-full text-text-secondary transition-colors duration-150 hover:text-accent focus-visible:text-accent"
      >
        <CircleHelp className="h-4 w-4" strokeWidth={1.5} />
      </button>
      <span
        role="tooltip"
        id={id}
        className={cn(
          "pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 w-56 -translate-x-1/2 rounded-md border border-border bg-surface p-3 text-xs leading-relaxed text-text-secondary opacity-0 shadow-md transition-opacity duration-150",
          "group-hover:opacity-100",
          open && "opacity-100"
        )}
      >
        {children}
      </span>
    </span>
  );
}
