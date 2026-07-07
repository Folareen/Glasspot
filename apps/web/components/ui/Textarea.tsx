import { cn } from "@/lib/cn";

type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
  error?: boolean;
};

export function Textarea({ className, rows = 4, error, ...props }: TextareaProps) {
  return (
    <textarea
      rows={rows}
      aria-invalid={error || undefined}
      className={cn(
        "min-h-[88px] w-full resize-y rounded-sm border bg-surface px-4 py-3 text-base text-text-primary outline-none transition-colors placeholder:text-text-secondary focus:border-accent",
        error ? "border-error focus:border-error" : "border-border",
        className
      )}
      {...props}
    />
  );
}
