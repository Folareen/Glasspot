import { Badge } from "./Badge";

type BadgeVariant = "neutral" | "accent" | "amber" | "indigo" | "rose" | "success" | "error" | "outline";

const statusMap: Record<string, { variant: BadgeVariant; label: string }> = {
  draft: { variant: "neutral", label: "Draft" },
  open: { variant: "accent", label: "Open" },
  closed: { variant: "outline", label: "Closed" },
  pending: { variant: "neutral", label: "Pending" },
  processing: { variant: "accent", label: "Processing" },
  funded: { variant: "success", label: "Funded" },
  completed: { variant: "success", label: "Completed" },
  // Money isn't lost, just incomplete, so this reads as a warning rather than a failure.
  underpaid: { variant: "amber", label: "Underpaid" },
  failed: { variant: "error", label: "Failed" },
  reversed: { variant: "error", label: "Reversed" },
};

type StatusBadgeProps = {
  status: string;
  className?: string;
};

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const entry = statusMap[status] ?? { variant: "neutral" as const, label: status };
  return (
    <Badge variant={entry.variant} className={className}>
      {entry.label}
    </Badge>
  );
}
