import { cn } from "@/lib/cn";

type BadgeVariant = "neutral" | "accent" | "amber" | "indigo" | "rose" | "success" | "error" | "outline";

const variantStyles: Record<BadgeVariant, string> = {
  neutral: "bg-surface-hover text-text-secondary",
  accent: "bg-accent-soft text-accent",
  amber: "bg-amber-soft text-amber",
  indigo: "bg-indigo-soft text-indigo",
  rose: "bg-rose-soft text-rose",
  success: "bg-success-soft text-success",
  error: "bg-error-soft text-error",
  outline: "border border-border text-text-secondary",
};

type BadgeProps = {
  variant?: BadgeVariant;
  className?: string;
  children: React.ReactNode;
};

export function Badge({ variant = "neutral", className, children }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium",
        variantStyles[variant],
        className
      )}
    >
      {children}
    </span>
  );
}
