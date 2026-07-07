import { ArrowDownToLine, ArrowUpFromLine, ReceiptText, RotateCcw, ArrowLeftRight } from "lucide-react";
import { DataTableGridRow, type DataTableColumn } from "@/components/ui/DataTable";
import { Money } from "@/components/ui/Money";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Text } from "@/components/ui/Text";
import type { TransactionResponse, TransactionType } from "@/lib/mock/types";

export const activityColumns: DataTableColumn[] = [
  { key: "type", label: "Type", width: "1.5fr" },
  { key: "date", label: "Date", width: "1.5fr" },
  { key: "amount", label: "Amount", width: "1fr", align: "right" },
  { key: "status", label: "Status", width: "1fr", align: "right" },
];

const iconByType: Record<TransactionType, typeof ArrowDownToLine> = {
  funding: ArrowDownToLine,
  contribution: ArrowDownToLine,
  payout: ArrowUpFromLine,
  refund: RotateCcw,
  reversal: RotateCcw,
  fee: ReceiptText,
  transfer: ArrowLeftRight,
};

const typeLabels: Record<TransactionType, string> = {
  funding: "Funding",
  contribution: "Contribution",
  payout: "Payout",
  refund: "Refund",
  reversal: "Reversal",
  fee: "Fee",
  transfer: "Transfer",
};

const moneyInTypes: TransactionType[] = ["funding", "contribution"];
const moneyOutTypes: TransactionType[] = ["payout", "refund", "reversal"];

function moneyColorFor(type: TransactionType) {
  if (moneyInTypes.includes(type)) return "success" as const;
  if (moneyOutTypes.includes(type)) return "error" as const;
  return "primary" as const;
}

type PotTransactionRowProps = {
  transaction: TransactionResponse;
};

export function PotTransactionRow({ transaction }: PotTransactionRowProps) {
  const Icon = iconByType[transaction.type];
  const date = new Date(transaction.createdAt);
  const dateLabel = date.toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" });
  const timeLabel = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  return (
    <>
      {/* Mobile: stacked row, own layout */}
      <div className="flex items-center gap-3 py-3 lg:hidden">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent">
          <Icon className="h-5 w-5" strokeWidth={1.5} />
        </span>
        <div className="min-w-0 flex-1">
          <Text weight="medium" className="truncate">
            {typeLabels[transaction.type]}
          </Text>
          <Text size="xs" color="secondary">
            {dateLabel} at {timeLabel}
          </Text>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <Money naira={transaction.amount} color={moneyColorFor(transaction.type)} className="font-medium" />
          <StatusBadge status={transaction.status} />
        </div>
      </div>

      {/* Desktop: column-aligned table row */}
      <DataTableGridRow
        columns={activityColumns}
        cells={[
          <div key="type" className="flex items-center gap-2">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent">
              <Icon className="h-4 w-4" strokeWidth={1.5} />
            </span>
            <Text weight="medium">{typeLabels[transaction.type]}</Text>
          </div>,
          <Text key="date" size="sm" color="secondary">
            {dateLabel} · {timeLabel}
          </Text>,
          <Money key="amount" naira={transaction.amount} color={moneyColorFor(transaction.type)} className="font-medium" />,
          <StatusBadge key="status" status={transaction.status} />,
        ]}
      />
    </>
  );
}
