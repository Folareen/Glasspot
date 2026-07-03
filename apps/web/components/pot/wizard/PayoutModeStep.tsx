import { cn } from "@/lib/cn";
import { Text } from "@/components/ui/Text";
import {
  PayoutModeIcon,
  payoutModeDescriptions,
  payoutModeLabels,
} from "@/components/pot/PayoutModeIcon";
import type { PayoutMode } from "@/lib/mock/types";

const modes: PayoutMode[] = ["target_based", "manual", "recurring", "rotation"];

type PayoutModeStepProps = {
  value: PayoutMode | null;
  onChange: (mode: PayoutMode) => void;
};

export function PayoutModeStep({ value, onChange }: PayoutModeStepProps) {
  return (
    <div className="flex flex-col gap-3">
      {modes.map((mode) => {
        const isSelected = value === mode;
        return (
          <button
            key={mode}
            type="button"
            onClick={() => onChange(mode)}
            className={cn(
              "flex items-start gap-3 rounded-md border p-4 text-left transition-colors duration-150",
              isSelected
                ? "border-accent bg-accent-soft"
                : "border-border bg-surface hover:bg-surface-hover"
            )}
          >
            <span
              className={cn(
                "flex h-11 w-11 shrink-0 items-center justify-center rounded-md",
                isSelected ? "bg-accent text-white" : "bg-surface-hover text-text-secondary"
              )}
            >
              <PayoutModeIcon mode={mode} />
            </span>
            <span className="flex flex-col gap-0.5">
              <Text weight="semibold">{payoutModeLabels[mode]}</Text>
              <Text size="sm" color="secondary">
                {payoutModeDescriptions[mode]}
              </Text>
            </span>
          </button>
        );
      })}
    </div>
  );
}
