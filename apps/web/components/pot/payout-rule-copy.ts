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
      if ("adminManualEnabled" in config && config.adminManualEnabled) {
        conditions.push("an admin decides to release it early");
      }
      if (conditions.length === 0) return "This pot pays out once its conditions are set.";
      return `This pot pays out once ${conditions.join(", or ")}.`;
    }
    case "recurring": {
      if (!("amountKobo" in config)) return "This pot pays out on a recurring schedule.";
      return `This pot pays out ${formatNaira(config.amountKobo)} every ${config.intervalDays} days, starting ${formatDate(config.nextRunAt)}.`;
    }
    case "rotation": {
      if (!("legs" in config)) return "This pot rotates the payout between members in order.";
      const remaining = config.legs.filter((leg) => !leg.firedAt).length;
      return `This pot pays out to each person in turn. ${remaining} of ${config.legs.length} turns still to go.`;
    }
    default:
      return "";
  }
}

export function isPayoutReady(config: PayoutConfig, mode: PotResponse["payoutMode"]): boolean {
  if (mode === "manual") return true;
  if (mode === "target_based" && "adminManualEnabled" in config) return Boolean(config.adminManualEnabled);
  return false;
}
