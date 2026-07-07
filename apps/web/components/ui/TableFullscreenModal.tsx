"use client";

import { useEffect } from "react";
import { X } from "lucide-react";
import { Text } from "@/components/ui/Text";

type TableFullscreenModalProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
};

export function TableFullscreenModal({ open, onClose, title, children }: TableFullscreenModalProps) {
  useEffect(() => {
    if (!open) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div role="dialog" aria-modal="true" aria-label={title} className="fixed inset-0 z-50 flex flex-col bg-background">
      <div className="flex h-16 shrink-0 items-center justify-between border-b border-border px-5 sm:px-8">
        <Text as="span" size="lg" weight="semibold">
          {title}
        </Text>
        <button
          type="button"
          onClick={onClose}
          aria-label="Exit fullscreen"
          className="flex h-11 w-11 items-center justify-center rounded-md text-text-secondary transition-colors duration-150 hover:bg-surface-hover hover:text-text-primary"
        >
          <X className="h-5 w-5" strokeWidth={1.5} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-5 py-6 sm:px-8">
        <div className="mx-auto max-w-5xl">{children}</div>
      </div>
    </div>
  );
}
