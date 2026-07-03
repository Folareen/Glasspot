import { cn } from "@/lib/cn";

type ProgressBarTone = "accent" | "success";

const toneStyles: Record<ProgressBarTone, string> = {
  accent: "bg-accent",
  success: "bg-success",
};

type ProgressBarProps = {
  value: number;
  className?: string;
  tone?: ProgressBarTone;
};

export function ProgressBar({ value, className, tone = "accent" }: ProgressBarProps) {
  const clamped = Math.min(100, Math.max(0, value));

  return (
    <div className={cn("h-2 w-full overflow-hidden rounded-full bg-surface-hover", className)}>
      <div
        className={cn("h-full rounded-full transition-all duration-200", toneStyles[tone])}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}
