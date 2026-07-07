"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Checkbox } from "@/components/ui/Checkbox";
import { InfoTip } from "@/components/ui/InfoTip";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { Text } from "@/components/ui/Text";
import { ApiError, contribute } from "@/lib/api";
import { useToast } from "@/lib/toast";
import { addNaira, formatNaira, INBOUND_FEE, nairaAmountToNumber, sanitizeAmountInput, toNairaAmount } from "@/lib/money";
import type { ContributionResponse, PotResponse } from "@/lib/types";

type ContributeModalProps = {
  open: boolean;
  onClose: () => void;
  pot: PotResponse;
  /** Called with the pending contribution right after the virtual account is issued, so the caller can show a "waiting for payment" state and start polling for it to resolve. */
  onContributed: (contribution: ContributionResponse) => void;
};

export function ContributeModal({ open, onClose, pot, onContributed }: ContributeModalProps) {
  const { showToast } = useToast();
  const [amount, setAmount] = useState("");
  const [anonymous, setAnonymous] = useState(false);
  const [amountError, setAmountError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const minNaira = nairaAmountToNumber(pot.minContribution);
  const maxNaira = pot.maxContribution ? nairaAmountToNumber(pot.maxContribution) : null;

  async function handleSubmit() {
    if (!amount.trim()) {
      setAmountError("Enter an amount.");
      return;
    }
    const naira = nairaAmountToNumber(amount);
    if (!naira || naira < minNaira) {
      setAmountError(`Enter at least ${formatNaira(pot.minContribution)}.`);
      return;
    }
    if (maxNaira !== null && pot.maxContribution && naira > maxNaira) {
      setAmountError(`The most you can contribute is ${formatNaira(pot.maxContribution)}.`);
      return;
    }
    const wireAmount = toNairaAmount(amount);
    if (!wireAmount) return;
    setAmountError("");
    setIsSubmitting(true);
    try {
      const contribution = await contribute(pot.id, { amount: wireAmount, anonymous });
      onContributed(contribution);
      setAmount("");
      setAnonymous(false);
      onClose();
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : "Couldn't start your contribution", "error");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Contribute to this pot">
      <div className="flex flex-col gap-4">
        <Text size="sm" color="secondary">
          We&apos;ll give you a virtual account to pay into. The contribution counts once that
          payment lands.
        </Text>
        <Field
          label="Amount"
          htmlFor="contribute-amount"
          required
          helperText={`Minimum ${formatNaira(pot.minContribution)}${pot.maxContribution ? `, maximum ${formatNaira(pot.maxContribution)}` : ""}`}
          error={amountError || undefined}
        >
          <Input
            id="contribute-amount"
            type="text"
            inputMode="decimal"
            value={amount}
            onChange={(e) => {
              setAmount(sanitizeAmountInput(e.target.value));
              setAmountError("");
            }}
            placeholder={String(minNaira)}
            error={Boolean(amountError)}
          />
        </Field>
        {(() => {
          const wireAmount = toNairaAmount(amount);
          if (!wireAmount) return null;
          const total = addNaira(wireAmount, INBOUND_FEE);
          return (
            <Text size="sm" color="secondary">
              You&apos;ll send {formatNaira(total)} in total — {formatNaira(wireAmount)} to the pot plus a flat {formatNaira(INBOUND_FEE)} fee.
            </Text>
          );
        })()}
        <div className="flex items-center gap-1.5">
          <Checkbox
            id="contribute-anonymous"
            checked={anonymous}
            onChange={(e) => setAnonymous(e.target.checked)}
            label="Contribute anonymously"
          />
          <InfoTip>Your contribution still counts toward the pot, but your name shows as &quot;Anonymous&quot; to everyone else instead of your real name.</InfoTip>
        </div>
        <Button className="w-full" onClick={handleSubmit} disabled={!amount || isSubmitting}>
          {isSubmitting && <Spinner size="sm" />}
          Continue
        </Button>
      </div>
    </Modal>
  );
}
