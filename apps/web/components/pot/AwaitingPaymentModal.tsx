"use client";

import { useEffect, useRef } from "react";
import { Modal } from "@/components/ui/Modal";
import { Text } from "@/components/ui/Text";
import { Spinner } from "@/components/ui/Spinner";
import { Money } from "@/components/ui/Money";
import { Button } from "@/components/ui/Button";
import { getPotTransactions } from "@/lib/api";
import { usePollUntil } from "@/lib/usePollUntil";
import type { ContributionResponse } from "@/lib/types";

type AwaitingPaymentModalProps = {
  open: boolean;
  onClose: () => void;
  potId: string;
  contribution: ContributionResponse | null;
  onResolved: () => void;
};

// Shown right after POST /pots/:id/contributions issues a virtual account — the contribution is
// only a pending funding intent at this point (see docs/system-rules.md), so this polls
// GET /pots/:id/transactions until a transaction referencing this contribution shows up
// (funded) or the modal is dismissed. The transaction list has no direct link back to a specific
// contribution id in its wire shape, so this polls the pot's balance state changing instead of
// matching a specific row: a new "contribution" transaction landing since this contribution was
// created is the funded signal.
export function AwaitingPaymentModal({ open, onClose, potId, contribution, onResolved }: AwaitingPaymentModalProps) {
  const { status, start, stop } = usePollUntil(async () => {
    if (!contribution) return null;
    const transactions = await getPotTransactions(potId);
    const fundedSince = transactions.find(
      (t) =>
        t.type === "contribution" &&
        t.status === "completed" &&
        new Date(t.createdAt).getTime() >= new Date(contribution.createdAt).getTime()
    );
    return fundedSince ?? null;
  });

  useEffect(() => {
    if (open && contribution) start();
    if (!open) stop();
  }, [open, contribution, start, stop]);

  // onResolved is typically a fresh inline closure on every parent render (it usually calls
  // setState itself, e.g. clearing the pending contribution) — depending on it directly would
  // re-fire this effect on every subsequent render as long as status stays "done", since the
  // dependency array sees a "changed" callback reference even though nothing meaningful changed.
  // A ref sidesteps that: the effect only re-runs when status itself transitions to "done".
  const onResolvedRef = useRef(onResolved);
  useEffect(() => {
    onResolvedRef.current = onResolved;
  }, [onResolved]);

  useEffect(() => {
    if (status === "done") onResolvedRef.current();
  }, [status]);

  if (!contribution) return null;

  return (
    <Modal open={open} onClose={onClose} title="Waiting for payment">
      <div className="flex flex-col items-center gap-4 py-2 text-center">
        <Spinner size="md" />
        <Text color="secondary">
          Pay <Money naira={contribution.expectedAmount} className="font-semibold" /> to the
          account below. This screen updates automatically once it lands.
        </Text>
        <div className="w-full rounded-md border border-border bg-surface-hover p-4">
          <Text size="xs" color="secondary">
            Account number
          </Text>
          <Text weight="semibold" size="lg">
            {contribution.virtualAccountNumber ?? "Generating..."}
          </Text>
        </div>
        <Button variant="secondary" className="w-full" onClick={onClose}>
          I&apos;ll pay later
        </Button>
      </div>
    </Modal>
  );
}
