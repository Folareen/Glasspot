"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { Text } from "@/components/ui/Text";
import { cn } from "@/lib/cn";

export type PageSize = 10 | 50 | "all";

export const pageSizeOptions: { value: PageSize; label: string }[] = [
  { value: 10, label: "10" },
  { value: 50, label: "50" },
  { value: "all", label: "All" },
];

type PaginationProps = {
  pageSize: PageSize;
  page: number;
  onPageChange: (page: number) => void;
  totalItems: number;
  className?: string;
};

// Prev/next row only — lives below the table. The page-size picker lives in
// TableToolbar above the table instead, since "how many rows" is a viewing
// preference set before you start reading, while "which page" is navigation
// you do after.
export function Pagination({ pageSize, page, onPageChange, totalItems, className }: PaginationProps) {
  const totalPages = pageSize === "all" ? 1 : Math.max(1, Math.ceil(totalItems / pageSize));

  if (pageSize === "all" || totalPages <= 1) return null;

  return (
    <div className={cn("flex items-center justify-between gap-3 sm:justify-center", className)}>
      <button
        type="button"
        onClick={() => onPageChange(Math.max(1, page - 1))}
        disabled={page <= 1}
        aria-label="Previous page"
        className="flex h-9 w-9 items-center justify-center rounded-md border border-border text-text-secondary transition-colors duration-150 hover:text-text-primary disabled:opacity-40 disabled:pointer-events-none"
      >
        <ChevronLeft className="h-4 w-4" strokeWidth={1.5} />
      </button>
      <Text size="xs" color="secondary">
        Page {page} of {totalPages}
      </Text>
      <button
        type="button"
        onClick={() => onPageChange(Math.min(totalPages, page + 1))}
        disabled={page >= totalPages}
        aria-label="Next page"
        className="flex h-9 w-9 items-center justify-center rounded-md border border-border text-text-secondary transition-colors duration-150 hover:text-text-primary disabled:opacity-40 disabled:pointer-events-none"
      >
        <ChevronRight className="h-4 w-4" strokeWidth={1.5} />
      </button>
    </div>
  );
}
