"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Text } from "@/components/ui/Text";
import { Spinner } from "@/components/ui/Spinner";
import { formatNaira, nairaAmountToNumber, toNairaAmount } from "@/lib/money";

type PayoutAmountModalProps = {
  open: boolean;
  onClose: () => void;
  onConfirm: (amount?: string) => void;
  /** Pot's current balance, wire-format naira string — shown as the amount field's cap. */
  balance: string;
};

export function PayoutAmountModal({ open, onClose, onConfirm, balance }: PayoutAmountModalProps) {
  const [amount, setAmount] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const balanceNaira = nairaAmountToNumber(balance);

  function handleClose() {
    setAmount("");
    onClose();
  }

  function handleConfirm() {
    const naira = nairaAmountToNumber(amount);
    if (amount && (!naira || naira <= 0 || naira > balanceNaira)) return;
    setIsSubmitting(true);
    onConfirm(amount ? (toNairaAmount(amount) ?? undefined) : undefined);
    setIsSubmitting(false);
    handleClose();
  }

  return (
    <Modal open={open} onClose={handleClose} title="Trigger payout?">
      <div className="flex flex-col gap-4">
        <Text color="secondary">
          This releases money to the payout account on file. This cannot be undone.
        </Text>

        <Field
          label="Amount"
          htmlFor="payout-amount"
          helperText={`Optional. Leave blank to send the full balance (${formatNaira(balance)}).`}
        >
          <Input
            id="payout-amount"
            type="number"
            inputMode="decimal"
            min={0}
            max={balanceNaira}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder={String(balanceNaira)}
          />
        </Field>

        <div className="flex gap-3">
          <Button variant="secondary" className="flex-1" onClick={handleClose}>
            Cancel
          </Button>
          <Button className="flex-1" onClick={handleConfirm} disabled={isSubmitting}>
            {isSubmitting && <Spinner size="sm" />}
            Trigger payout
          </Button>
        </div>
      </div>
    </Modal>
  );
}
