"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Checkbox } from "@/components/ui/Checkbox";
import { Button } from "@/components/ui/Button";
import { useMockStore } from "@/lib/mock/store";
import { useToast } from "@/lib/toast";
import { formatNaira, nairaAmountToNumber, toNairaAmount } from "@/lib/money";
import type { PotResponse } from "@/lib/mock/types";

type ContributeModalProps = {
  open: boolean;
  onClose: () => void;
  pot: PotResponse;
};

export function ContributeModal({ open, onClose, pot }: ContributeModalProps) {
  const { contribute } = useMockStore();
  const { showToast } = useToast();
  const [amount, setAmount] = useState("");
  const [anonymous, setAnonymous] = useState(false);

  const minNaira = nairaAmountToNumber(pot.minContribution);
  const maxNaira = pot.maxContribution ? nairaAmountToNumber(pot.maxContribution) : null;

  function handleSubmit() {
    const naira = nairaAmountToNumber(amount);
    if (!naira || naira < minNaira || (maxNaira !== null && naira > maxNaira)) return;
    const wireAmount = toNairaAmount(amount);
    if (!wireAmount) return;
    contribute(pot.id, wireAmount, anonymous);
    showToast("Contribution received", "success");
    setAmount("");
    setAnonymous(false);
    onClose();
  }

  return (
    <Modal open={open} onClose={onClose} title="Contribute to this pot">
      <div className="flex flex-col gap-4">
        <Field
          label="Amount"
          htmlFor="contribute-amount"
          required
          helperText={`Minimum ${formatNaira(pot.minContribution)}${pot.maxContribution ? `, maximum ${formatNaira(pot.maxContribution)}` : ""}`}
        >
          <Input
            id="contribute-amount"
            type="number"
            inputMode="decimal"
            min={minNaira}
            max={maxNaira ?? undefined}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder={String(minNaira)}
          />
        </Field>
        <Checkbox
          id="contribute-anonymous"
          checked={anonymous}
          onChange={(e) => setAnonymous(e.target.checked)}
          label="Contribute anonymously"
        />
        <Button className="w-full" onClick={handleSubmit} disabled={!amount}>
          Contribute
        </Button>
      </div>
    </Modal>
  );
}
