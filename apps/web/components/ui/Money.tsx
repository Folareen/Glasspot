import { cn } from "@/lib/cn";

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

const formatter = new Intl.NumberFormat("en-NG", {
  style: "currency",
  currency: "NGN",
});

type MoneyProps = {
  kobo: string | number;
  className?: string;
  size?: MoneySize;
  color?: MoneyColor;
};

export function Money({ kobo, className, size = "base", color = "primary" }: MoneyProps) {
  const naira = Number(kobo) / 100;

  return (
    <span className={cn("tabular-nums", sizeStyles[size], colorStyles[color], className)}>
      {formatter.format(naira)}
    </span>
  );
}
