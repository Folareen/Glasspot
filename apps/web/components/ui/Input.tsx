import { cn } from "@/lib/cn";

type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

export function Input({ className, ...props }: InputProps) {
  return (
    <input
      className={cn(
        "h-12 w-full rounded-sm border border-border bg-surface px-4 text-base text-text-primary outline-none transition-colors placeholder:text-text-secondary focus:border-accent",
        className
      )}
      {...props}
    />
  );
}
