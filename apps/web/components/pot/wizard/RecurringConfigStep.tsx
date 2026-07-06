import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { nigerianBanks } from "@/lib/mock/fixtures";
import type { WizardState } from "./wizard-types";

type RecurringConfigStepProps = {
  state: WizardState;
  onChange: (patch: Partial<WizardState>) => void;
};

export function RecurringConfigStep({ state, onChange }: RecurringConfigStepProps) {
  return (
    <div className="flex flex-col gap-5">
      <Field label="Payout account number" htmlFor="recurring-account" required>
        <Input
          id="recurring-account"
          inputMode="numeric"
          maxLength={10}
          value={state.recurringDestinationAccount}
          onChange={(e) => onChange({ recurringDestinationAccount: e.target.value })}
          placeholder="0123456789"
        />
      </Field>

      <Field label="Payout bank" htmlFor="recurring-bank" required>
        <Select
          id="recurring-bank"
          value={state.recurringDestinationBank}
          onChange={(e) => onChange({ recurringDestinationBank: e.target.value })}
        >
          <option value="">Select a bank</option>
          {nigerianBanks.map((bank) => (
            <option key={bank.code} value={bank.code}>
              {bank.name}
            </option>
          ))}
        </Select>
      </Field>

      <Field
        label="Amount per payout"
        htmlFor="recurring-amount"
        helperText="In naira. Must be greater than 0."
        required
      >
        <Input
          id="recurring-amount"
          type="number"
          inputMode="decimal"
          min={0}
          value={state.recurringAmountNaira}
          onChange={(e) => onChange({ recurringAmountNaira: e.target.value })}
          placeholder="1000"
        />
      </Field>

      <Field label="Repeat every" htmlFor="recurring-interval" helperText="In days" required>
        <Input
          id="recurring-interval"
          type="number"
          inputMode="numeric"
          min={1}
          value={state.recurringIntervalDays}
          onChange={(e) => onChange({ recurringIntervalDays: e.target.value })}
        />
      </Field>

      <Field label="First payout date" htmlFor="recurring-next-run" required>
        <Input
          id="recurring-next-run"
          type="date"
          value={state.recurringNextRunAt}
          onChange={(e) => onChange({ recurringNextRunAt: e.target.value })}
        />
      </Field>
    </div>
  );
}
