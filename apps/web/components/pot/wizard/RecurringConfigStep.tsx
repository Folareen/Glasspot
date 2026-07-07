import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { useBanks } from "@/lib/useBanks";
import { isPositiveAmount } from "./wizard-helpers";
import type { WizardState } from "./wizard-types";

type RecurringConfigStepProps = {
  state: WizardState;
  onChange: (patch: Partial<WizardState>) => void;
  /** Show validation messages. Lifted from the parent wizard page's Continue/Save click, so errors only appear after a submit attempt. */
  showErrors?: boolean;
};

export function RecurringConfigStep({ state, onChange, showErrors }: RecurringConfigStepProps) {
  const { banks } = useBanks();
  // Errors mirror isConfigStepValid's "recurring" case (wizard-helpers.ts)
  // field for field, so a message only shows for whichever condition that
  // rule is actually failing on.
  const accountError =
    showErrors && !state.recurringDestinationAccount ? "Enter the payout account number." : undefined;
  const bankError = showErrors && !state.recurringDestinationBank ? "Choose the payout bank." : undefined;
  const amountError =
    showErrors && !isPositiveAmount(state.recurringAmountNaira) ? "Enter an amount greater than 0." : undefined;
  const intervalError =
    showErrors && !state.recurringIntervalDays ? "Enter how many days between payouts." : undefined;
  const nextRunError =
    showErrors && !state.recurringNextRunAt ? "Choose the first payout date." : undefined;

  return (
    <div className="flex flex-col gap-5">
      <Field label="Payout account number" htmlFor="recurring-account" required error={accountError}>
        <Input
          id="recurring-account"
          inputMode="numeric"
          maxLength={10}
          value={state.recurringDestinationAccount}
          onChange={(e) => onChange({ recurringDestinationAccount: e.target.value })}
          placeholder="0123456789"
          error={Boolean(accountError)}
        />
      </Field>

      <Field label="Payout bank" htmlFor="recurring-bank" required error={bankError}>
        <Select
          id="recurring-bank"
          value={state.recurringDestinationBank}
          onChange={(e) => onChange({ recurringDestinationBank: e.target.value })}
          error={Boolean(bankError)}
        >
          <option value="">Select a bank</option>
          {banks.map((bank) => (
            <option key={bank.code} value={bank.code}>
              {bank.name}
            </option>
          ))}
        </Select>
      </Field>

      <Field
        label="Amount per payout"
        htmlFor="recurring-amount"
        helperText={amountError ? undefined : "In naira. Must be greater than 0."}
        required
        error={amountError}
      >
        <Input
          id="recurring-amount"
          type="number"
          inputMode="decimal"
          min={0}
          value={state.recurringAmountNaira}
          onChange={(e) => onChange({ recurringAmountNaira: e.target.value })}
          placeholder="1000"
          error={Boolean(amountError)}
        />
      </Field>

      <Field
        label="Repeat every"
        htmlFor="recurring-interval"
        helperText={intervalError ? undefined : "In days"}
        required
        error={intervalError}
        info="Counts from the first payout date below. For example, every 30 days starting July 1 pays out July 1, July 31, August 30, and so on."
      >
        <Input
          id="recurring-interval"
          type="number"
          inputMode="numeric"
          min={1}
          value={state.recurringIntervalDays}
          onChange={(e) => onChange({ recurringIntervalDays: e.target.value })}
          error={Boolean(intervalError)}
        />
      </Field>

      <Field label="First payout date" htmlFor="recurring-next-run" required error={nextRunError}>
        <Input
          id="recurring-next-run"
          type="date"
          value={state.recurringNextRunAt}
          onChange={(e) => onChange({ recurringNextRunAt: e.target.value })}
          error={Boolean(nextRunError)}
        />
      </Field>
    </div>
  );
}
