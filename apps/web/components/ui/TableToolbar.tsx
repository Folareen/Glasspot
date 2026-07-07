"use client";

import { Download, Maximize2 } from "lucide-react";
import { Text } from "@/components/ui/Text";
import { pageSizeOptions, type PageSize } from "@/components/ui/Pagination";
import { cn } from "@/lib/cn";

type TableToolbarProps = {
  /** Omit entirely when the table has nothing worth paging (e.g. a short member list). */
  pageSize?: PageSize;
  onPageSizeChange?: (size: PageSize) => void;
  /** Filename (no extension) and row data for the CSV export button. */
  exportFilename: string;
  exportHeaders: string[];
  exportRows: string[][];
  onExpand: () => void;
  className?: string;
};

function downloadCsv(filename: string, headers: string[], rows: string[][]) {
  const escapeCell = (cell: string) => (/[",\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell);
  const csv = [headers, ...rows].map((row) => row.map(escapeCell).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${filename}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

export function TableToolbar({
  pageSize,
  onPageSizeChange,
  exportFilename,
  exportHeaders,
  exportRows,
  onExpand,
  className,
}: TableToolbarProps) {
  return (
    <div className={cn("flex items-center justify-between gap-3", className)}>
      {pageSize && onPageSizeChange ? (
        <div className="flex items-center gap-2">
          <Text size="xs" color="secondary">
            Show
          </Text>
          <div className="flex items-center gap-1 rounded-md border border-border bg-surface p-1">
            {pageSizeOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => onPageSizeChange(option.value)}
                className={cn(
                  "rounded-sm px-2.5 py-1 text-xs font-medium transition-colors duration-150",
                  pageSize === option.value
                    ? "bg-accent text-white"
                    : "text-text-secondary hover:text-text-primary"
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <span />
      )}

      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => downloadCsv(exportFilename, exportHeaders, exportRows)}
          disabled={exportRows.length === 0}
          aria-label="Export as CSV"
          title="Export as CSV"
          className="flex h-9 w-9 items-center justify-center rounded-md text-text-secondary transition-colors duration-150 hover:bg-surface-hover hover:text-text-primary disabled:opacity-40 disabled:pointer-events-none"
        >
          <Download className="h-4 w-4" strokeWidth={1.5} />
        </button>
        <button
          type="button"
          onClick={onExpand}
          aria-label="View fullscreen"
          title="View fullscreen"
          className="flex h-9 w-9 items-center justify-center rounded-md text-text-secondary transition-colors duration-150 hover:bg-surface-hover hover:text-text-primary"
        >
          <Maximize2 className="h-4 w-4" strokeWidth={1.5} />
        </button>
      </div>
    </div>
  );
}
