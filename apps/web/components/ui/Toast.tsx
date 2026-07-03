import { cn } from "@/lib/cn";

export type ToastVariant = "default" | "success" | "error";

const variantStyles: Record<ToastVariant, string> = {
  default: "bg-surface border-border text-text-primary",
  success: "bg-success-soft border-success/25 text-success",
  error: "bg-error-soft border-error/25 text-error",
};

type ToastProps = {
  message: string;
  variant?: ToastVariant;
  className?: string;
};

export function Toast({ message, variant = "default", className }: ToastProps) {
  return (
    <div
      role="status"
      className={cn(
        "rounded-md border px-4 py-3 text-sm font-medium shadow-lg",
        variantStyles[variant],
        className
      )}
    >
      {message}
    </div>
  );
}
