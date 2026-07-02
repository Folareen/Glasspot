import { cn } from "@/lib/cn";

type CardPadding = "sm" | "md" | "lg";
type CardTone = "neutral" | "accent";

const paddingStyles: Record<CardPadding, string> = {
  sm: "p-4",
  md: "p-6",
  lg: "p-8",
};

const toneStyles: Record<CardTone, string> = {
  neutral: "bg-surface border-border",
  accent: "bg-accent-soft border-accent/25",
};

type CardProps = {
  padding?: CardPadding;
  tone?: CardTone;
  className?: string;
  children: React.ReactNode;
};

export function Card({ padding = "md", tone = "neutral", className, children }: CardProps) {
  return (
    <div
      className={cn(
        "rounded-md border",
        toneStyles[tone],
        paddingStyles[padding],
        className
      )}
    >
      {children}
    </div>
  );
}
