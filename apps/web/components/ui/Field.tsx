import { cn } from "@/lib/cn";
import { Text } from "./Text";
import { InfoTip } from "./InfoTip";

type FieldProps = {
  label?: string;
  htmlFor?: string;
  error?: string;
  helperText?: string;
  required?: boolean;
  info?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
};

export function Field({
  label,
  htmlFor,
  error,
  helperText,
  required,
  info,
  className,
  children,
}: FieldProps) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {label && (
        <span className="flex items-center gap-1.5">
          <label htmlFor={htmlFor} className="text-sm font-medium text-text-primary">
            {label}
            {required && <span className="text-error"> *</span>}
          </label>
          {info && <InfoTip>{info}</InfoTip>}
        </span>
      )}
      {children}
      {error ? (
        <Text size="xs" color="error">
          {error}
        </Text>
      ) : helperText ? (
        <Text size="xs" color="secondary">
          {helperText}
        </Text>
      ) : null}
    </div>
  );
}
