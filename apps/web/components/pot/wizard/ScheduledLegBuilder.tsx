import { Plus, Trash2 } from "lucide-react";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { Text } from "@/components/ui/Text";
import { Card } from "@/components/ui/Card";
import { Divider } from "@/components/ui/Divider";
import { nigerianBanks } from "@/lib/mock/fixtures";
import type { ScheduledLeg } from "@/lib/mock/types";

type ScheduledLegBuilderProps = {
  ordered: boolean;
  legs: ScheduledLeg[];
  onChange: (legs: ScheduledLeg[]) => void;
};

function emptyLeg(sequenceOrder: number): ScheduledLeg {
  return {
    destinationAccount: "",
    destinationBank: "",
    sequenceOrder,
    amountKobo: "",
    scheduledDate: "",
    firedAt: null,
  };
}

export function ScheduledLegBuilder({ ordered, legs, onChange }: ScheduledLegBuilderProps) {
  const legLabel = ordered ? "Turn" : "Payout";

  function updateLeg(index: number, patch: Partial<ScheduledLeg>) {
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

      {legs.map((leg, index) => (
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
            <Field label="Account number" htmlFor={`leg-account-${index}`} required>
              <Input
                id={`leg-account-${index}`}
                inputMode="numeric"
                maxLength={10}
                value={leg.destinationAccount}
                onChange={(e) => updateLeg(index, { destinationAccount: e.target.value })}
                placeholder="0123456789"
              />
            </Field>
            <Field label="Bank" htmlFor={`leg-bank-${index}`} required>
              <Select
                id={`leg-bank-${index}`}
                value={leg.destinationBank}
                onChange={(e) => updateLeg(index, { destinationBank: e.target.value })}
              >
                <option value="">Select a bank</option>
                {nigerianBanks.map((bank) => (
                  <option key={bank.code} value={bank.code}>
                    {bank.name}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Amount" htmlFor={`leg-amount-${index}`} helperText="In naira" required>
                <Input
                  id={`leg-amount-${index}`}
                  type="number"
                  inputMode="decimal"
                  min={0}
                  value={leg.amountKobo}
                  onChange={(e) => updateLeg(index, { amountKobo: e.target.value })}
                  placeholder="250000"
                />
              </Field>
              <Field label="Date" htmlFor={`leg-date-${index}`} required>
                <Input
                  id={`leg-date-${index}`}
                  type="date"
                  value={leg.scheduledDate}
                  onChange={(e) => updateLeg(index, { scheduledDate: e.target.value })}
                />
              </Field>
            </div>
          </div>
        </Card>
      ))}

      <Divider />

      <Button type="button" variant="secondary" onClick={addLeg}>
        <Plus className="h-4 w-4" strokeWidth={1.5} />
        Add another {legLabel.toLowerCase()}
      </Button>
    </div>
  );
}
