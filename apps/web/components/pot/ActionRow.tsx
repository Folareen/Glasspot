import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Text } from "@/components/ui/Text";
import { cn } from "@/lib/cn";

type ActionRowProps = {
  icon: React.ReactNode;
  title: string;
  description: string;
  buttonLabel?: string;
  onClick?: () => void;
  danger?: boolean;
  disabled?: boolean;
};

// Actions read as a list of "what can I do and what does it mean" rather
// than a stack of full-width colored bars — only the button itself carries
// weight, and only Close pot (destructive) uses danger color.
export function ActionRow({ icon, title, description, buttonLabel, onClick, danger, disabled }: ActionRowProps) {
  return (
    <Card padding="sm">
      <div className="flex items-center gap-3">
        <span
          className={cn(
            "flex h-11 w-11 shrink-0 items-center justify-center rounded-full",
            disabled
              ? "bg-surface-hover text-text-secondary"
              : danger
                ? "bg-error-soft text-error"
                : "bg-accent-soft text-accent"
          )}
        >
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <Text weight="medium">{title}</Text>
          <Text size="sm" color="secondary" className="mt-0.5">
            {description}
          </Text>
        </div>
        {!disabled && (
          <Button
            variant={danger ? "danger" : "secondary"}
            size="sm"
            className="shrink-0"
            onClick={onClick}
          >
            {buttonLabel}
          </Button>
        )}
      </div>
    </Card>
  );
}
