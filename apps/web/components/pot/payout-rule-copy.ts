import type { PayoutConfig, PotResponse } from "@/lib/mock/types";

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-NG", { day: "numeric", month: "long", year: "numeric" });
}

function formatNaira(kobo: string) {
  return new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN" }).format(Number(kobo) / 100);
}

export function describePayoutRule(pot: PotResponse): string {
  const config = pot.payoutConfig;

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
      if ("targetAmountKobo" in config && config.targetAmountKobo) {
        conditions.push(`the pot reaches ${formatNaira(config.targetAmountKobo)}`);
      }
      if (conditions.length === 0) return "This pot pays out once its conditions are set.";
      return `This pot pays out once ${conditions.join(", or ")}.`;
    }
    case "recurring": {
      if (!("amountKobo" in config)) return "This pot pays out on a fixed interval, repeating automatically.";
      return `This pot pays out ${formatNaira(config.amountKobo)} every ${config.intervalDays} days, starting ${formatDate(config.nextRunAt)}.`;
    }
    case "scheduled": {
      if (!("legs" in config)) return "This pot pays out on a set schedule of legs.";
      const remaining = config.legs.filter((leg) => !leg.firedAt).length;
      return config.ordered
        ? `This pot pays out to each person in turn. ${remaining} of ${config.legs.length} turns still to go.`
        : `This pot pays out on a fixed schedule of legs. ${remaining} of ${config.legs.length} still to go.`;
    }
    default:
      return "";
  }
}

// target_based never has an on-demand trigger — it only fires via its own
// automatic rule (target date/amount reached), never admin discretion.
export function isPayoutReady(config: PayoutConfig, mode: PotResponse["payoutMode"]): boolean {
  return mode === "manual";
}
