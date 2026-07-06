"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Checkbox } from "@/components/ui/Checkbox";
import { Button } from "@/components/ui/Button";
import { useMockStore } from "@/lib/mock/store";
import { useToast } from "@/lib/toast";
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

  const minNaira = Number(pot.minContribution) / 100;
  const maxNaira = pot.maxContribution ? Number(pot.maxContribution) / 100 : null;

  function handleSubmit() {
    const naira = Number(amount);
    if (!naira || naira < minNaira || (maxNaira !== null && naira > maxNaira)) return;
    contribute(pot.id, String(Math.round(naira * 100)), anonymous);
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
          helperText={`Minimum ₦${minNaira.toLocaleString()}${maxNaira ? `, maximum ₦${maxNaira.toLocaleString()}` : ""}`}
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
