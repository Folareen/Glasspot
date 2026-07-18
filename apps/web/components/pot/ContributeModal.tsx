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
import { addNaira, formatNaira, inboundFeeFor, nairaAmountToNumber, sanitizeAmountInput, toNairaAmount } from "@/lib/money";
import type { ContributionResponse, PotResponse } from "@/lib/types";

type ContributeModalProps = {
  open: boolean;
  onClose: () => void;
  pot: PotResponse;
  /** Called with the pending contribution right after the virtual account is issued, so the caller can show a "waiting for payment" state and start polling for it to resolve. */
  onContributed: (contribution: ContributionResponse) => void;
};

// Retried up to this many times before giving up and showing the error toast — each attempt sends
// a fresh Idempotency-Key, so a retry gets a brand new Nomba accountRef rather than replaying
// whatever the failed attempt got back (see contributions.service.ts's virtual-account guard: a
// 502 here means Nomba's own response was missing the account number, which a fresh call from
// Nomba can plausibly succeed at on the next try).
const VIRTUAL_ACCOUNT_MAX_ATTEMPTS = 3;
const VIRTUAL_ACCOUNT_RETRY_DELAY_MS = 1500;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
      let lastError: unknown;
      for (let attempt = 1; attempt <= VIRTUAL_ACCOUNT_MAX_ATTEMPTS; attempt++) {
        try {
          const contribution = await contribute(pot.id, { amount: wireAmount, anonymous });
          onContributed(contribution);
          setAmount("");
          setAnonymous(false);
          onClose();
          return;
        } catch (e) {
          lastError = e;
          // Only retry the "upstream payments provider" failure (502, see
          // contributions.service.ts's virtual-account guard) — every other error (bad amount,
          // pot closed, network down, etc) would just fail the same way again, so retrying it
          // silently would only delay a toast the user needs to see now.
          const isRetryable = e instanceof ApiError && e.status === 502;
          if (!isRetryable || attempt === VIRTUAL_ACCOUNT_MAX_ATTEMPTS) break;
          await sleep(VIRTUAL_ACCOUNT_RETRY_DELAY_MS);
        }
      }
      showToast(
        lastError instanceof ApiError ? lastError.message : "Couldn't start your contribution",
        "error"
      );
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
          const fee = inboundFeeFor(wireAmount);
          const total = addNaira(wireAmount, fee);
          return (
            <Text size="sm" color="secondary">
              You&apos;ll send {formatNaira(total)} in total — {formatNaira(wireAmount)} to the pot plus a {formatNaira(fee)} fee.
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
