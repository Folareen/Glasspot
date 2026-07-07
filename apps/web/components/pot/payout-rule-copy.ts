import type { PotResponse } from "@/lib/types";
import { formatNaira } from "@/lib/money";

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-NG", { day: "numeric", month: "long", year: "numeric" });
}

export function describePayoutRule(pot: PotResponse): string {
  const config = pot.payoutConfig;
  if (!config) return "";

  switch (pot.payoutMode) {
    case "manual": {
      if ("destinationAccount" in config && config.destinationAccount && config.destinationBank) {
        return "An admin can trigger a payout at any time, always to the same fixed account, as many times as needed.";
      }
      return "An admin can send the balance to any account whenever they choose. The destination is picked at the time of payout, and stays visible to everyone afterward.";
    }
    case "target_based": {
      const conditions: string[] = [];
      if ("targetDate" in config && config.targetDate) {
        conditions.push(`the target date, ${formatDate(config.targetDate)}, arrives`);
      }
      if ("targetAmount" in config && config.targetAmount) {
        conditions.push(`the pot reaches ${formatNaira(config.targetAmount)}`);
      }
      if (conditions.length === 0) return "This pot pays out once its conditions are set.";
      return `This pot pays out once ${conditions.join(", or ")}.`;
    }
    case "recurring": {
      if (!("amount" in config)) return "This pot pays out on a fixed interval, repeating automatically.";
      return `This pot pays out ${formatNaira(config.amount)} every ${config.intervalDays} days, starting ${formatDate(config.nextRunAt)}.`;
    }
    case "scheduled": {
      if (!("legs" in config)) return "This pot pays out on a set schedule of legs.";
      const remaining = config.legs.filter((leg) => !leg.fired).length;
      return config.ordered
        ? `This pot pays out to each person in turn. ${remaining} of ${config.legs.length} turns still to go.`
        : `This pot pays out on a fixed schedule of legs. ${remaining} of ${config.legs.length} still to go.`;
    }
    default:
      return "";
  }
}
