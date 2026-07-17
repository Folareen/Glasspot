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
import { useBanks } from "@/lib/useBanks";
import { useBankAccountLookup } from "@/lib/useBankAccountLookup";
import { requestPayoutOtp, triggerPayout } from "@/lib/api";
import { addNaira, formatNaira, nairaAmountToNumber, OUTBOUND_FEE, sanitizeAmountInput, subtractNaira, toNairaAmount } from "@/lib/money";

type PayoutDestinationModalProps = {
  open: boolean;
  onClose: () => void;
  potId: string;
  onConfirmed: () => void;
  /** Pot's current balance, wire-format naira string — shown as the amount field's placeholder/cap. */
  balance: string;
};

export function PayoutDestinationModal({ open, onClose, potId, onConfirmed, balance }: PayoutDestinationModalProps) {
  const { banks } = useBanks();
  const [step, setStep] = useState<"destination" | "otp">("destination");
  const [account, setAccount] = useState("");
  const [bank, setBank] = useState("");
  const [amount, setAmount] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errors, setErrors] = useState<{ account?: string; bank?: string; amount?: string }>({});
  const { confirmedName, isLookingUp, error: lookupError } = useBankAccountLookup(account, bank);

  const balanceNaira = nairaAmountToNumber(balance);
  const wireAmount = amount ? (toNairaAmount(amount) ?? undefined) : undefined;
  // Same flat ₦50 outbound fee rule as PayoutAmountModal — see that file's comment.
  const fullBalancePayout = subtractNaira(balance, OUTBOUND_FEE);
  const maxSendableNaira = nairaAmountToNumber(fullBalancePayout);
  // Below the fee threshold, nothing can be sent at all (even the "leave blank" full-balance
  // path would fail the same fee check server-side) — block the whole flow instead of showing a
  // negative amount.
  const belowFeeThreshold = maxSendableNaira <= 0;

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
    if (account && bank && !confirmedName) {
      nextErrors.account = "Wait for the account name to be confirmed.";
    }
    if (amount) {
      const naira = nairaAmountToNumber(amount);
      if (!naira || naira <= 0) {
        nextErrors.amount = "Enter an amount greater than 0.";
      } else if (naira > maxSendableNaira) {
        nextErrors.amount = `You can send up to ${formatNaira(fullBalancePayout)} — a flat ${formatNaira(OUTBOUND_FEE)} fee applies on top.`;
      }
    }
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }
    setErrors({});
    setStep("otp");
  }

  async function handleRequestCode() {
    await requestPayoutOtp(potId, { destinationAccount: account, destinationBank: bank, amount: wireAmount });
  }

  async function handleVerify(otpCode: string) {
    setIsSubmitting(true);
    try {
      await triggerPayout(potId, { destinationAccount: account, destinationBank: bank, amount: wireAmount, otpCode });
      onConfirmed();
      handleClose();
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Modal open={open} onClose={handleClose} title="Send payout to">
      {step === "destination" ? (
        <div className="flex flex-col gap-4">
          <Text size="sm" color="secondary">
            This pot pays out to any account an admin chooses. Pick where the balance goes this
            time, everyone in the pot will be able to see it afterward.
          </Text>

          {belowFeeThreshold ? (
            <>
              <Text size="sm" color="error">
                This pot's balance ({formatNaira(balance)}) doesn't cover the flat {formatNaira(OUTBOUND_FEE)} payout
                fee, so nothing can be sent right now.
              </Text>
              <Button variant="secondary" className="w-full" onClick={handleClose}>
                Close
              </Button>
            </>
          ) : (
            <>
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
                  searchable
                  searchPlaceholder="Search banks..."
                >
                  <option value="">Select a bank</option>
                  {banks.map((b) => (
                    <option key={b.code} value={b.code}>
                      {b.name}
                    </option>
                  ))}
                </Select>
              </Field>

              {isLookingUp && (
                <div className="flex items-center gap-2">
                  <Spinner size="sm" />
                  <Text size="sm" color="secondary">
                    Verifying account...
                  </Text>
                </div>
              )}

              {confirmedName && !isLookingUp && (
                <Field label="Account name">
                  <Text weight="medium">{confirmedName}</Text>
                </Field>
              )}

              {lookupError && !isLookingUp && (
                <Text size="sm" color="error">
                  {lookupError}
                </Text>
              )}

              <Field
                label="Amount"
                htmlFor="payout-destination-amount"
                helperText={errors.amount ? undefined : `Optional. Leave blank to send the full balance minus fee (${formatNaira(fullBalancePayout)}). A flat ${formatNaira(OUTBOUND_FEE)} fee applies on top of any amount you enter.`}
                error={errors.amount}
              >
                <Input
                  id="payout-destination-amount"
                  type="text"
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => {
                    setAmount(sanitizeAmountInput(e.target.value));
                    setErrors((prev) => ({ ...prev, amount: undefined }));
                  }}
                  placeholder={String(balanceNaira)}
                  error={Boolean(errors.amount)}
                />
              </Field>
              {amount && !errors.amount && (
                <Text size="sm" color="secondary">
                  {formatNaira(addNaira(toNairaAmount(amount) ?? "0.00", OUTBOUND_FEE))} will be deducted from the pot — {formatNaira(toNairaAmount(amount) ?? "0.00")} to the recipient plus the {formatNaira(OUTBOUND_FEE)} fee.
                </Text>
              )}

              <div className="flex gap-3">
                <Button variant="secondary" className="flex-1" onClick={handleClose}>
                  Cancel
                </Button>
                <Button
                  className="flex-1"
                  onClick={handleContinue}
                  disabled={isSubmitting || !account || !bank || !confirmedName}
                >
                  {isSubmitting && <Spinner size="sm" />}
                  Continue
                </Button>
              </div>
            </>
          )}
        </div>
      ) : (
        <OtpStep
          description="Enter the code we sent to your email to confirm this payout."
          confirmLabel="Send payout"
          onBack={() => setStep("destination")}
          onRequestCode={handleRequestCode}
          onVerify={handleVerify}
        />
      )}
    </Modal>
  );
}
