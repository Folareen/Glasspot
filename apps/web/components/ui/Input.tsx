import { cn } from "@/lib/cn";

type InputProps = React.InputHTMLAttributes<HTMLInputElement> & {
  error?: boolean;
};

export function Input({ className, error, ...props }: InputProps) {
  return (
    <input
      aria-invalid={error || undefined}
      className={cn(
        "h-12 w-full rounded-sm border bg-surface px-4 text-base text-text-primary outline-none transition-colors placeholder:text-text-secondary focus:border-accent",
        error ? "border-error focus:border-error" : "border-border",
        className
      )}
      {...props}
    />
  );
}
