"use client";

import { useEffect, useState } from "react";
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
import { PageHeading } from "@/components/layout/PageHeading";
import { Container } from "@/components/ui/Container";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Money } from "@/components/ui/Money";
import { Spinner } from "@/components/ui/Spinner";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Tabs } from "@/components/ui/Tabs";
import { Text } from "@/components/ui/Text";
import { ApiError, getMyTransactions } from "@/lib/api";
import { useToast } from "@/lib/toast";
import type { MeTransaction, TransactionType } from "@/lib/types";

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

function TransactionRow({ transaction }: { transaction: MeTransaction }) {
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
          naira={transaction.amount}
          color={moneyColorFor(transaction.type)}
          className="font-medium"
        />
        <StatusBadge status={transaction.status} />
      </div>
    </Card>
  );
}

export default function ActivityPage() {
  const { showToast } = useToast();
  const [transactions, setTransactions] = useState<MeTransaction[] | null>(null);

  useEffect(() => {
    getMyTransactions()
      .then(setTransactions)
      .catch((e) => {
        showToast(e instanceof ApiError ? e.message : "Couldn't load your activity", "error");
        setTransactions([]);
      });
  }, [showToast]);

  if (transactions === null) {
    return (
      <div className="flex justify-center py-16">
        <Spinner size="md" />
      </div>
    );
  }

  const sorted = [...transactions].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  if (sorted.length === 0) {
    return (
      <>
        <AppHeader title="Activity" />
        <Container className="py-6 lg:py-10">
          <PageHeading title="Activity" className="mb-6 hidden lg:block" />
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
      <Container className="py-6 lg:py-10">
        <PageHeading title="Activity" className="mb-6 hidden lg:block" />
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
