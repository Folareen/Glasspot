import { Repeat, Target, Timer, Zap } from "lucide-react";
import type { PayoutMode } from "@/lib/mock/types";
import { cn } from "@/lib/cn";

const iconByMode: Record<PayoutMode, typeof Target> = {
  target_based: Target,
  manual: Zap,
  recurring: Timer,
  rotation: Repeat,
};

type PayoutModeIconProps = {
  mode: PayoutMode;
  className?: string;
};

export function PayoutModeIcon({ mode, className }: PayoutModeIconProps) {
  const Icon = iconByMode[mode];
  return <Icon className={cn("h-5 w-5", className)} strokeWidth={1.5} />;
}

export const payoutModeLabels: Record<PayoutMode, string> = {
  target_based: "Target based",
  manual: "Manual",
  recurring: "Recurring",
  rotation: "Rotation",
};

export const payoutModeDescriptions: Record<PayoutMode, string> = {
  target_based: "Pays out when a date is reached, a target amount is hit, or an admin triggers it.",
  manual: "An admin can release the balance at any time, as many times as needed.",
  recurring: "Pays a fixed amount out on a fixed schedule until the pot closes.",
  rotation: "Pays out to each person in order, one turn at a time, like a traditional ajo.",
};
