import { cn } from "@/lib/cn";
import { formatNaira } from "@/lib/money";

type MoneySize = "xs" | "sm" | "base" | "lg" | "xl";
type MoneyColor = "primary" | "secondary" | "accent" | "success" | "error";

const sizeStyles: Record<MoneySize, string> = {
  xs: "text-xs",
  sm: "text-sm",
  base: "text-base",
  lg: "text-lg leading-relaxed",
  xl: "text-xl leading-relaxed",
};

const colorStyles: Record<MoneyColor, string> = {
  primary: "text-text-primary",
  secondary: "text-text-secondary",
  accent: "text-accent",
  success: "text-success",
  error: "text-error",
};

type MoneyProps = {
  /** Wire-format naira string, e.g. "100.50" — never kobo. */
  naira: string;
  className?: string;
  size?: MoneySize;
  color?: MoneyColor;
};

export function Money({ naira, className, size = "base", color = "primary" }: MoneyProps) {
  return (
    <span className={cn("tabular-nums", sizeStyles[size], colorStyles[color], className)}>
      {formatNaira(naira)}
    </span>
  );
}
