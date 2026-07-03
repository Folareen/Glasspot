import { cn } from "@/lib/cn";
import { Heading } from "./Heading";
import { Text } from "./Text";

type EmptyStateProps = {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
};

export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn("flex flex-col items-center gap-3 py-12 text-center", className)}>
      {icon && (
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-accent-soft text-accent">
          {icon}
        </span>
      )}
      <Heading level={4}>{title}</Heading>
      {description && (
        <Text color="secondary" className="max-w-sm">
          {description}
        </Text>
      )}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
