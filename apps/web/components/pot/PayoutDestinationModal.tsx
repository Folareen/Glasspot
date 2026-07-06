"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { Text } from "@/components/ui/Text";
import { Spinner } from "@/components/ui/Spinner";
import { nigerianBanks } from "@/lib/mock/fixtures";
import { toNairaAmount } from "@/lib/money";

type PayoutDestinationModalProps = {
  open: boolean;
  onClose: () => void;
  onConfirm: (destination: { account: string; bank: string }, amount?: string) => void;
  /** Pot's current balance, wire-format naira string — shown as the amount field's placeholder/cap. */
  balance: string;
};

export function PayoutDestinationModal({ open, onClose, onConfirm, balance }: PayoutDestinationModalProps) {
  const [account, setAccount] = useState("");
  const [bank, setBank] = useState("");
  const [amount, setAmount] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const balanceNaira = Number(balance);

  function handleClose() {
    setAccount("");
    setBank("");
    setAmount("");
    onClose();
  }

  function handleConfirm() {
    if (!account || !bank) return;
    const naira = Number(amount);
    if (amount && (!naira || naira <= 0 || naira > balanceNaira)) return;
    setIsSubmitting(true);
    onConfirm({ account, bank }, amount ? (toNairaAmount(amount) ?? undefined) : undefined);
    setIsSubmitting(false);
    handleClose();
  }

  return (
    <Modal open={open} onClose={handleClose} title="Send payout to">
      <div className="flex flex-col gap-4">
        <Text size="sm" color="secondary">
          This pot pays out to any account an admin chooses. Pick where the balance goes this
          time, everyone in the pot will be able to see it afterward.
        </Text>

        <Field label="Account number" htmlFor="payout-destination-account" required>
          <Input
            id="payout-destination-account"
            inputMode="numeric"
            maxLength={10}
            value={account}
            onChange={(e) => setAccount(e.target.value)}
            placeholder="0123456789"
          />
        </Field>

        <Field label="Bank" htmlFor="payout-destination-bank" required>
          <Select id="payout-destination-bank" value={bank} onChange={(e) => setBank(e.target.value)}>
            <option value="">Select a bank</option>
            {nigerianBanks.map((b) => (
              <option key={b.code} value={b.code}>
                {b.name}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label="Amount"
          htmlFor="payout-destination-amount"
          helperText={`Optional. Leave blank to send the full balance (₦${balanceNaira.toLocaleString()}).`}
        >
          <Input
            id="payout-destination-amount"
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
          <Button className="flex-1" onClick={handleConfirm} disabled={!account || !bank || isSubmitting}>
            {isSubmitting && <Spinner size="sm" />}
            Send payout
          </Button>
        </div>
      </div>
    </Modal>
  );
}
