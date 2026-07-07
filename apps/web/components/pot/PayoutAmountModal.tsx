"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Text } from "@/components/ui/Text";
import { Spinner } from "@/components/ui/Spinner";
import { OtpStep } from "@/components/pot/OtpStep";
import { requestPayoutOtp, triggerPayout } from "@/lib/api";
import { formatNaira, nairaAmountToNumber, sanitizeAmountInput, toNairaAmount } from "@/lib/money";

type PayoutAmountModalProps = {
  open: boolean;
  onClose: () => void;
  potId: string;
  onConfirmed: () => void;
  /** Pot's current balance, wire-format naira string — shown as the amount field's cap. */
  balance: string;
};

export function PayoutAmountModal({ open, onClose, potId, onConfirmed, balance }: PayoutAmountModalProps) {
  const [step, setStep] = useState<"amount" | "otp">("amount");
  const [amount, setAmount] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [amountError, setAmountError] = useState("");

  const balanceNaira = nairaAmountToNumber(balance);
  const wireAmount = amount ? (toNairaAmount(amount) ?? undefined) : undefined;

  function handleClose() {
    setStep("amount");
    setAmount("");
    setAmountError("");
    onClose();
  }

  function handleContinue() {
    if (!amount) {
      setStep("otp");
      return;
    }
    const naira = nairaAmountToNumber(amount);
    if (!naira || naira <= 0) {
      setAmountError("Enter an amount greater than 0.");
      return;
    }
    if (naira > balanceNaira) {
      setAmountError(`You can't send more than the pot's balance (${formatNaira(balance)}).`);
      return;
    }
    setAmountError("");
    setStep("otp");
  }

  async function handleRequestCode() {
    await requestPayoutOtp(potId, { amount: wireAmount });
  }

  async function handleVerify(otpCode: string) {
    setIsSubmitting(true);
    try {
      await triggerPayout(potId, { amount: wireAmount, otpCode });
      onConfirmed();
      handleClose();
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Modal open={open} onClose={handleClose} title="Trigger payout?">
      {step === "amount" ? (
        <div className="flex flex-col gap-4">
          <Text color="secondary">
            This releases money to the payout account on file. This cannot be undone.
          </Text>

          <Field
            label="Amount"
            htmlFor="payout-amount"
            helperText={amountError ? undefined : `Optional. Leave blank to send the full balance (${formatNaira(balance)}).`}
            error={amountError || undefined}
          >
            <Input
              id="payout-amount"
              type="text"
              inputMode="decimal"
              value={amount}
              onChange={(e) => {
                setAmount(sanitizeAmountInput(e.target.value));
                setAmountError("");
              }}
              placeholder={String(balanceNaira)}
              error={Boolean(amountError)}
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
          confirmLabel="Trigger payout"
          onBack={() => setStep("amount")}
          onRequestCode={handleRequestCode}
          onVerify={handleVerify}
        />
      )}
    </Modal>
  );
}
