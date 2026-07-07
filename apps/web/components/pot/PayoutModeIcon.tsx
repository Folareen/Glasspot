import { Calendar, Repeat, Target, Zap } from "lucide-react";
import type { PayoutMode } from "@/lib/types";
import { cn } from "@/lib/cn";

const iconByMode: Record<PayoutMode, typeof Target> = {
  target_based: Target,
  manual: Zap,
  recurring: Repeat,
  scheduled: Calendar,
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
  scheduled: "Scheduled",
};

export const payoutModeDescriptions: Record<PayoutMode, string> = {
  target_based: "Pays out automatically once a target amount or date is reached.",
  manual: "An admin can release the balance at any time, as many times as needed.",
  recurring: "Pays a fixed amount out on a fixed interval, repeating automatically until the pot closes.",
  scheduled:
    "Set each payout's destination, amount, and date upfront. Choose whether turns go in order — a traditional ajo — or fire independently, for staged payments.",
};
