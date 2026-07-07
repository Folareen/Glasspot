"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { Text } from "@/components/ui/Text";
import { Spinner } from "@/components/ui/Spinner";
import { OtpStep } from "@/components/pot/OtpStep";
import { nigerianBanks } from "@/lib/mock/fixtures";
import { formatNaira, nairaAmountToNumber, toNairaAmount } from "@/lib/money";

type PayoutDestinationModalProps = {
  open: boolean;
  onClose: () => void;
  onConfirm: (destination: { account: string; bank: string }, amount?: string) => void;
  /** Pot's current balance, wire-format naira string — shown as the amount field's placeholder/cap. */
  balance: string;
};

export function PayoutDestinationModal({ open, onClose, onConfirm, balance }: PayoutDestinationModalProps) {
  const [step, setStep] = useState<"destination" | "otp">("destination");
  const [account, setAccount] = useState("");
  const [bank, setBank] = useState("");
  const [amount, setAmount] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errors, setErrors] = useState<{ account?: string; bank?: string; amount?: string }>({});

  const balanceNaira = nairaAmountToNumber(balance);

  function handleClose() {
    setStep("destination");
    setAccount("");
    setBank("");
    setAmount("");
    setErrors({});
    onClose();
  }

  function handleContinue() {
    const nextErrors: { account?: string; bank?: string; amount?: string } = {};
    if (!account) {
      nextErrors.account = "Enter the account number.";
    }
    if (!bank) {
      nextErrors.bank = "Choose the bank.";
    }
    if (amount) {
      const naira = nairaAmountToNumber(amount);
      if (!naira || naira <= 0) {
        nextErrors.amount = "Enter an amount greater than 0.";
      } else if (naira > balanceNaira) {
        nextErrors.amount = `You can't send more than the pot's balance (${formatNaira(balance)}).`;
      }
    }
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }
    setErrors({});
    setStep("otp");
  }

  function handleVerified() {
    setIsSubmitting(true);
    onConfirm({ account, bank }, amount ? (toNairaAmount(amount) ?? undefined) : undefined);
    setIsSubmitting(false);
    handleClose();
  }

  return (
    <Modal open={open} onClose={handleClose} title="Send payout to">
      {step === "destination" ? (
        <div className="flex flex-col gap-4">
          <Text size="sm" color="secondary">
            This pot pays out to any account an admin chooses. Pick where the balance goes this
            time, everyone in the pot will be able to see it afterward.
          </Text>

          <Field label="Account number" htmlFor="payout-destination-account" required error={errors.account}>
            <Input
              id="payout-destination-account"
              inputMode="numeric"
              maxLength={10}
              value={account}
              onChange={(e) => {
                setAccount(e.target.value);
                setErrors((prev) => ({ ...prev, account: undefined }));
              }}
              placeholder="0123456789"
              error={Boolean(errors.account)}
            />
          </Field>

          <Field label="Bank" htmlFor="payout-destination-bank" required error={errors.bank}>
            <Select
              id="payout-destination-bank"
              value={bank}
              onChange={(e) => {
                setBank(e.target.value);
                setErrors((prev) => ({ ...prev, bank: undefined }));
              }}
              error={Boolean(errors.bank)}
            >
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
            helperText={errors.amount ? undefined : `Optional. Leave blank to send the full balance (${formatNaira(balance)}).`}
            error={errors.amount}
          >
            <Input
              id="payout-destination-amount"
              type="number"
              inputMode="decimal"
              min={0}
              max={balanceNaira}
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value);
                setErrors((prev) => ({ ...prev, amount: undefined }));
              }}
              placeholder={String(balanceNaira)}
              error={Boolean(errors.amount)}
            />
          </Field>

          <div className="flex gap-3">
            <Button variant="secondary" className="flex-1" onClick={handleClose}>
              Cancel
            </Button>
            <Button className="flex-1" onClick={handleContinue} disabled={isSubmitting}>
              {isSubmitting && <Spinner size="sm" />}
              Continue
            </Button>
          </div>
        </div>
      ) : (
        <OtpStep
          description="Enter the code we sent to your email to confirm this payout."
          confirmLabel="Send payout"
          onBack={() => setStep("destination")}
          onVerified={handleVerified}
        />
      )}
    </Modal>
  );
}
