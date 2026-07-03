import { cn } from "@/lib/cn";

type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>;

export function Textarea({ className, rows = 4, ...props }: TextareaProps) {
  return (
    <textarea
      rows={rows}
      className={cn(
        "min-h-[88px] w-full resize-y rounded-sm border border-border bg-surface px-4 py-3 text-base text-text-primary outline-none transition-colors placeholder:text-text-secondary focus:border-accent",
        className
      )}
      {...props}
    />
  );
}
