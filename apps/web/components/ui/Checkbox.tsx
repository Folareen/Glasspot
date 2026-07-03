import { Check } from "lucide-react";
import { cn } from "@/lib/cn";

type CheckboxProps = React.InputHTMLAttributes<HTMLInputElement> & {
  label?: string;
};

export function Checkbox({ label, className, id, ...props }: CheckboxProps) {
  return (
    <label
      htmlFor={id}
      className={cn("flex min-h-11 cursor-pointer items-center gap-3", className)}
    >
      <span className="relative inline-flex h-5 w-5 shrink-0 items-center justify-center">
        <input
          type="checkbox"
          id={id}
          className="peer absolute inset-0 h-full w-full cursor-pointer appearance-none rounded-sm border border-border bg-surface transition-colors checked:border-accent checked:bg-accent"
          {...props}
        />
        <Check
          className="pointer-events-none relative hidden h-3.5 w-3.5 text-white peer-checked:block"
          strokeWidth={3}
        />
      </span>
      {label && <span className="text-sm text-text-primary">{label}</span>}
    </label>
  );
}
