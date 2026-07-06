"use client";

import Link from "next/link";
import {
  ArrowDownToLine,
  ArrowLeftRight,
  ArrowUpFromLine,
  ReceiptText,
  RotateCcw,
  ArrowLeftRight as ActivityIcon,
} from "lucide-react";
import { AppHeader } from "@/components/layout/AppHeader";
import { Container } from "@/components/ui/Container";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Money } from "@/components/ui/Money";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Tabs } from "@/components/ui/Tabs";
import { Text } from "@/components/ui/Text";
import { useMockStore } from "@/lib/mock/store";
import type { TransactionResponse, TransactionType } from "@/lib/mock/types";

const filterTabs = [
  { id: "all", label: "All" },
  { id: "payout", label: "Payouts" },
  { id: "refund", label: "Refunds" },
  { id: "contribution", label: "Contributions" },
];

const typeGroups: Record<string, TransactionType[]> = {
  payout: ["payout"],
  refund: ["refund", "reversal"],
  contribution: ["contribution", "funding"],
};

const iconByType: Record<TransactionType, typeof ArrowDownToLine> = {
  funding: ArrowDownToLine,
  contribution: ArrowDownToLine,
  payout: ArrowUpFromLine,
  refund: RotateCcw,
  reversal: RotateCcw,
  fee: ReceiptText,
  transfer: ArrowLeftRight,
};

const moneyInTypes: TransactionType[] = ["funding", "contribution"];
const moneyOutTypes: TransactionType[] = ["payout", "refund", "reversal"];

function moneyColorFor(type: TransactionType) {
  if (moneyInTypes.includes(type)) return "success" as const;
  if (moneyOutTypes.includes(type)) return "error" as const;
  return "primary" as const;
}

function TransactionRow({ transaction }: { transaction: TransactionResponse }) {
  const Icon = iconByType[transaction.type];
  const date = new Date(transaction.createdAt);

  return (
    <Card padding="sm" className="flex items-center gap-3">
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent">
        <Icon className="h-5 w-5" strokeWidth={1.5} />
      </span>
      <div className="min-w-0 flex-1">
        <Link href={`/pots/${transaction.potId}`} className="block truncate">
          <Text weight="medium" className="truncate">
            {transaction.potTitle}
          </Text>
        </Link>
        <Text size="xs" color="secondary">
          {date.toLocaleDateString()} at{" "}
          {date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </Text>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <Money
          kobo={transaction.amount}
          color={moneyColorFor(transaction.type)}
          className="font-medium"
        />
        <StatusBadge status={transaction.status} />
      </div>
    </Card>
  );
}

export default function ActivityPage() {
  const { transactions } = useMockStore();

  const sorted = [...transactions].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  if (sorted.length === 0) {
    return (
      <>
        <AppHeader title="Activity" />
        <Container className="py-6">
          <EmptyState
            icon={<ActivityIcon className="h-7 w-7" strokeWidth={1.5} />}
            title="No activity yet"
            description="Transactions across your pots will show up here."
          />
        </Container>
      </>
    );
  }

  return (
    <>
      <AppHeader title="Activity" />
      <Container className="py-6">
        <Tabs tabs={filterTabs}>
          {(activeTabId) => {
            const filtered =
              activeTabId === "all"
                ? sorted
                : sorted.filter((transaction) => typeGroups[activeTabId]?.includes(transaction.type));

            if (filtered.length === 0) {
              return (
                <EmptyState
                  icon={<ActivityIcon className="h-7 w-7" strokeWidth={1.5} />}
                  title="No activity"
                  description="No transactions match this filter."
                />
              );
            }

            return (
              <div className="flex flex-col gap-3">
                {filtered.map((transaction) => (
                  <TransactionRow key={transaction.id} transaction={transaction} />
                ))}
              </div>
            );
          }}
        </Tabs>
      </Container>
    </>
  );
}
