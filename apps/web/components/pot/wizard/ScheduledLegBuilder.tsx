import { Plus, Trash2 } from "lucide-react";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { Text } from "@/components/ui/Text";
import { Card } from "@/components/ui/Card";
import { Divider } from "@/components/ui/Divider";
import { useBanks } from "@/lib/useBanks";
import { isPositiveAmount } from "./wizard-helpers";
import type { WizardScheduledLeg } from "./wizard-types";

type LegErrors = {
  account?: string;
  bank?: string;
  amount?: string;
  date?: string;
};

const NO_ERRORS: LegErrors = {};

/** Per-leg field errors, mirroring isConfigStepValid's "scheduled" case (wizard-helpers.ts) field for field. */
function legErrors(leg: WizardScheduledLeg): LegErrors {
  return {
    account: leg.destinationAccount ? undefined : "Enter the account number.",
    bank: leg.destinationBank ? undefined : "Choose the bank.",
    amount: isPositiveAmount(leg.amount) ? undefined : "Enter an amount greater than 0.",
    date: leg.scheduledDate ? undefined : "Choose a date.",
  };
}

type ScheduledLegBuilderProps = {
  ordered: boolean;
  legs: WizardScheduledLeg[];
  onChange: (legs: WizardScheduledLeg[]) => void;
  /** Show validation messages. Lifted from the parent wizard page's Continue/Save click, so errors only appear after a submit attempt. */
  showErrors?: boolean;
};

function emptyLeg(sequenceOrder: number): WizardScheduledLeg {
  return {
    destinationAccount: "",
    destinationBank: "",
    sequenceOrder,
    amount: "",
    scheduledDate: "",
  };
}

export function ScheduledLegBuilder({ ordered, legs, onChange, showErrors }: ScheduledLegBuilderProps) {
  const { banks } = useBanks();
  const legLabel = ordered ? "Turn" : "Payout";

  function updateLeg(index: number, patch: Partial<WizardScheduledLeg>) {
    onChange(legs.map((leg, i) => (i === index ? { ...leg, ...patch } : leg)));
  }

  function addLeg() {
    onChange([...legs, emptyLeg(legs.length)]);
  }

  function removeLeg(index: number) {
    onChange(
      legs.filter((_, i) => i !== index).map((leg, i) => ({ ...leg, sequenceOrder: i }))
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Text size="sm" color="secondary">
        {ordered
          ? "Add each person's turn in order. Every leg gets its own amount and date, and fires once when its turn comes up."
          : "Add each payout. Every leg gets its own destination, amount, and date, and fires independently once its date arrives — the same destination can repeat across legs."}
      </Text>

      {legs.map((leg, index) => {
        const errors = showErrors ? legErrors(leg) : NO_ERRORS;
        return (
          <Card key={index} padding="md">
            <div className="mb-3 flex items-center justify-between">
              <Text weight="semibold">{legLabel} {index + 1}</Text>
              {legs.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeLeg(index)}
                  aria-label={`Remove ${legLabel.toLowerCase()} ${index + 1}`}
                  className="flex h-11 w-11 items-center justify-center text-text-secondary transition-colors duration-150 hover:text-error"
                >
                  <Trash2 className="h-4 w-4" strokeWidth={1.5} />
                </button>
              )}
            </div>
            <div className="flex flex-col gap-4">
              <Field label="Account number" htmlFor={`leg-account-${index}`} required error={errors.account}>
                <Input
                  id={`leg-account-${index}`}
                  inputMode="numeric"
                  maxLength={10}
                  value={leg.destinationAccount}
                  onChange={(e) => updateLeg(index, { destinationAccount: e.target.value })}
                  placeholder="0123456789"
                  error={Boolean(errors.account)}
                />
              </Field>
              <Field label="Bank" htmlFor={`leg-bank-${index}`} required error={errors.bank}>
                <Select
                  id={`leg-bank-${index}`}
                  value={leg.destinationBank}
                  onChange={(e) => updateLeg(index, { destinationBank: e.target.value })}
                  error={Boolean(errors.bank)}
                >
                  <option value="">Select a bank</option>
                  {banks.map((bank) => (
                    <option key={bank.code} value={bank.code}>
                      {bank.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <div className="grid grid-cols-2 gap-4">
                <Field
                  label="Amount"
                  htmlFor={`leg-amount-${index}`}
                  helperText={errors.amount ? undefined : "In naira. Must be greater than 0."}
                  required
                  error={errors.amount}
                >
                  <Input
                    id={`leg-amount-${index}`}
                    type="number"
                    inputMode="decimal"
                    min={0}
                    value={leg.amount}
                    onChange={(e) => updateLeg(index, { amount: e.target.value })}
                    placeholder="2500"
                    error={Boolean(errors.amount)}
                  />
                </Field>
                <Field label="Date" htmlFor={`leg-date-${index}`} required error={errors.date}>
                  <Input
                    id={`leg-date-${index}`}
                    type="date"
                    value={leg.scheduledDate}
                    onChange={(e) => updateLeg(index, { scheduledDate: e.target.value })}
                    error={Boolean(errors.date)}
                  />
                </Field>
              </div>
            </div>
          </Card>
        );
      })}

      <Divider />

      <Button type="button" variant="secondary" onClick={addLeg}>
        <Plus className="h-4 w-4" strokeWidth={1.5} />
        Add another {legLabel.toLowerCase()}
      </Button>
    </div>
  );
}
