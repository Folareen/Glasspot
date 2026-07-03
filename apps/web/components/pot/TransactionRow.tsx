import { ArrowDownToLine, ArrowUpFromLine, ReceiptText, RotateCcw } from "lucide-react";
import { Money } from "@/components/ui/Money";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Text } from "@/components/ui/Text";
import { nigerianBanks } from "@/lib/mock/fixtures";
import type { TransactionResponse, TransactionType } from "@/lib/mock/types";

const iconByType: Record<TransactionType, typeof ArrowDownToLine> = {
  funding: ArrowDownToLine,
  contribution: ArrowDownToLine,
  payout: ArrowUpFromLine,
  refund: RotateCcw,
  reversal: RotateCcw,
  fee: ReceiptText,
  transfer: ReceiptText,
};

const isMoneyIn: Record<TransactionType, boolean> = {
  funding: true,
  contribution: true,
  payout: false,
  refund: false,
  reversal: false,
  fee: false,
  transfer: false,
};

type TransactionRowProps = {
  transaction: TransactionResponse;
};

export function TransactionRow({ transaction }: TransactionRowProps) {
  const Icon = iconByType[transaction.type];
  const moneyColor = isMoneyIn[transaction.type] ? "success" : "error";
  const bankName = transaction.destinationBank
    ? nigerianBanks.find((bank) => bank.code === transaction.destinationBank)?.name
    : undefined;

  return (
    <div className="flex items-center gap-3 py-3">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface-hover text-text-secondary">
        <Icon className="h-4 w-4" strokeWidth={1.5} />
      </span>
      <div className="min-w-0 flex-1">
        <Text weight="medium" className="capitalize">
          {transaction.type}
        </Text>
        <Text size="xs" color="secondary">
          {new Date(transaction.createdAt).toLocaleDateString("en-NG", {
            day: "numeric",
            month: "short",
            hour: "numeric",
            minute: "2-digit",
          })}
        </Text>
        {transaction.destinationAccount && (
          <Text size="xs" color="secondary" className="truncate">
            Sent to {transaction.destinationAccount} · {bankName ?? transaction.destinationBank}
          </Text>
        )}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <Money kobo={transaction.amountKobo} color={moneyColor} className="font-medium" />
        <StatusBadge status={transaction.status} />
      </div>
    </div>
  );
}
