import { cn } from "@/lib/cn";

type TextSize = "xs" | "sm" | "base" | "lg" | "xl";
type TextColor = "primary" | "secondary" | "accent" | "success" | "error";
type TextWeight = "regular" | "medium" | "semibold";

const sizeStyles: Record<TextSize, string> = {
  xs: "text-xs",
  sm: "text-sm",
  base: "text-base",
  lg: "text-lg leading-relaxed",
  xl: "text-xl leading-relaxed",
};

const colorStyles: Record<TextColor, string> = {
  primary: "text-text-primary",
  secondary: "text-text-secondary",
  accent: "text-accent",
  success: "text-success",
  error: "text-error",
};

const weightStyles: Record<TextWeight, string> = {
  regular: "font-normal",
  medium: "font-medium",
  semibold: "font-semibold",
};

type TextProps = {
  as?: "p" | "span" | "div";
  size?: TextSize;
  color?: TextColor;
  weight?: TextWeight;
  className?: string;
  children: React.ReactNode;
};

export function Text({
  as: Tag = "p",
  size = "base",
  color = "primary",
  weight = "regular",
  className,
  children,
}: TextProps) {
  return (
    <Tag
      className={cn(
        sizeStyles[size],
        colorStyles[color],
        weightStyles[weight],
        className
      )}
    >
      {children}
    </Tag>
  );
}
