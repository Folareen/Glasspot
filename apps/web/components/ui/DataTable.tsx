import { Card } from "@/components/ui/Card";
import { Text } from "@/components/ui/Text";
import { cn } from "@/lib/cn";

export type DataTableColumn = {
  key: string;
  label: string;
  align?: "left" | "right";
  /** Grid column width, e.g. "2fr" or "120px". Defaults to "1fr". */
  width?: string;
};

type DataTableProps = {
  columns: DataTableColumn[];
  rows: React.ReactNode[];
  className?: string;
};

// Renders as a stacked list on mobile (each row owns its own internal layout)
// and a real column-aligned table from lg: up, with a header row. Rows are
// passed in pre-rendered (not data + a render prop) so each row component
// (TransactionRow, MemberRow, ...) keeps full control of its own mobile
// layout while this component only adds the desktop grid + header chrome.
export function DataTable({ columns, rows, className }: DataTableProps) {
  const gridTemplate = columns.map((col) => col.width ?? "1fr").join(" ");

  return (
    <Card padding="sm" className={cn("overflow-hidden lg:p-0", className)}>
      <div
        className="hidden bg-surface-hover px-4 py-3 lg:grid"
        style={{ gridTemplateColumns: gridTemplate }}
      >
        {columns.map((col) => (
          <Text
            key={col.key}
            size="xs"
            weight="medium"
            color="secondary"
            className={cn("uppercase tracking-wide", col.align === "right" && "text-right")}
          >
            {col.label}
          </Text>
        ))}
      </div>
      <div className="flex flex-col divide-y divide-border lg:px-4">{rows}</div>
    </Card>
  );
}

type DataTableRowProps = {
  columns: DataTableColumn[];
  cells: React.ReactNode[];
  href?: string;
  className?: string;
};

// Desktop-only grid row that pairs with DataTable's header. Used inside a
// row component's own markup so that component can render its normal mobile
// layout above/around this, and this piece only takes over from lg: up.
export function DataTableGridRow({ columns, cells, className }: DataTableRowProps) {
  const gridTemplate = columns.map((col) => col.width ?? "1fr").join(" ");

  return (
    <div
      className={cn("hidden items-center py-3 lg:grid", className)}
      style={{ gridTemplateColumns: gridTemplate }}
    >
      {cells.map((cell, index) => (
        <div key={columns[index]?.key ?? index} className={cn(columns[index]?.align === "right" && "text-right")}>
          {cell}
        </div>
      ))}
    </div>
  );
}
