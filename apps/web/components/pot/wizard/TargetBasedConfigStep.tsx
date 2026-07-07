import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Card } from "@/components/ui/Card";
import { Text } from "@/components/ui/Text";
import { nigerianBanks } from "@/lib/mock/fixtures";
import { isPositiveAmount } from "./wizard-helpers";
import type { WizardState } from "./wizard-types";

type TargetBasedConfigStepProps = {
  state: WizardState;
  onChange: (patch: Partial<WizardState>) => void;
  /** Show validation messages. Lifted from the parent wizard page's Continue/Save click, so errors only appear after a submit attempt. */
  showErrors?: boolean;
};

export function TargetBasedConfigStep({ state, onChange, showErrors }: TargetBasedConfigStepProps) {
  // isPositiveAmount, not Boolean(): a target amount of "0" is truthy as a
  // string but isConfigStepValid (wizard-helpers.ts) rejects it as not a
  // real target — matching this warning to that same rule so the message
  // doesn't silently disappear on a "0" the Next button still blocks.
  const hasAtLeastOneCondition = Boolean(state.targetDate) || isPositiveAmount(state.targetAmountNaira);

  const accountError =
    showErrors && !state.targetDestinationAccount ? "Enter the payout account number." : undefined;
  const bankError = showErrors && !state.targetDestinationBank ? "Choose the payout bank." : undefined;

  return (
    <div className="flex flex-col gap-5">
      <Field label="Payout account number" htmlFor="target-account" required error={accountError}>
        <Input
          id="target-account"
          inputMode="numeric"
          maxLength={10}
          value={state.targetDestinationAccount}
          onChange={(e) => onChange({ targetDestinationAccount: e.target.value })}
          placeholder="0123456789"
          error={Boolean(accountError)}
        />
      </Field>

      <Field label="Payout bank" htmlFor="target-bank" required error={bankError}>
        <Select
          id="target-bank"
          value={state.targetDestinationBank}
          onChange={(e) => onChange({ targetDestinationBank: e.target.value })}
          error={Boolean(bankError)}
        >
          <option value="">Select a bank</option>
          {nigerianBanks.map((bank) => (
            <option key={bank.code} value={bank.code}>
              {bank.name}
            </option>
          ))}
        </Select>
      </Field>

      <div>
        <Text size="sm" weight="medium">
          Pick at least one way this pot can pay out
        </Text>
        <Text size="xs" color="secondary" className="mt-0.5">
          Any one of these happening triggers the payout, not all of them.
        </Text>
      </div>

      <Card padding="md" className="flex flex-col gap-4">
        <Field label="Target date" htmlFor="target-date" helperText="Optional">
          <Input
            id="target-date"
            type="date"
            value={state.targetDate}
            onChange={(e) => onChange({ targetDate: e.target.value })}
          />
        </Field>

        <div className="flex items-center gap-3">
          <div className="h-px flex-1 bg-border" />
          <Text size="xs" color="secondary">
            or
          </Text>
          <div className="h-px flex-1 bg-border" />
        </div>

        <Field
          label="Target amount"
          htmlFor="target-amount"
          helperText="In naira, optional. Leave blank to rely on the date instead — don't enter 0."
        >
          <Input
            id="target-amount"
            type="number"
            inputMode="decimal"
            min={0}
            value={state.targetAmountNaira}
            onChange={(e) => onChange({ targetAmountNaira: e.target.value })}
            placeholder="15000"
          />
        </Field>
      </Card>

      {showErrors && !hasAtLeastOneCondition && (
        <Text size="xs" color="error">
          Set at least a target date or a target amount.
        </Text>
      )}
    </div>
  );
}
