import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Checkbox } from "@/components/ui/Checkbox";
import { Card } from "@/components/ui/Card";
import { Text } from "@/components/ui/Text";
import { nigerianBanks } from "@/lib/mock/fixtures";
import type { WizardState } from "./wizard-types";

type TargetBasedConfigStepProps = {
  state: WizardState;
  onChange: (patch: Partial<WizardState>) => void;
};

export function TargetBasedConfigStep({ state, onChange }: TargetBasedConfigStepProps) {
  const hasAtLeastOneCondition =
    Boolean(state.targetDate) || Boolean(state.targetAmountNaira) || state.adminManualEnabled;

  return (
    <div className="flex flex-col gap-5">
      <Field label="Payout account number" htmlFor="target-account" required>
        <Input
          id="target-account"
          inputMode="numeric"
          maxLength={10}
          value={state.targetDestinationAccount}
          onChange={(e) => onChange({ targetDestinationAccount: e.target.value })}
          placeholder="0123456789"
        />
      </Field>

      <Field label="Payout bank" htmlFor="target-bank" required>
        <Select
          id="target-bank"
          value={state.targetDestinationBank}
          onChange={(e) => onChange({ targetDestinationBank: e.target.value })}
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

        <Field label="Target amount" htmlFor="target-amount" helperText="In naira, optional">
          <Input
            id="target-amount"
            type="number"
            inputMode="decimal"
            min={0}
            value={state.targetAmountNaira}
            onChange={(e) => onChange({ targetAmountNaira: e.target.value })}
            placeholder="1500000"
          />
        </Field>

        <div className="flex items-center gap-3">
          <div className="h-px flex-1 bg-border" />
          <Text size="xs" color="secondary">
            or
          </Text>
          <div className="h-px flex-1 bg-border" />
        </div>

        <Checkbox
          id="target-admin-manual"
          checked={state.adminManualEnabled}
          onChange={(e) => onChange({ adminManualEnabled: e.target.checked })}
          label="Let an admin trigger the payout manually at any time"
        />
      </Card>

      {!hasAtLeastOneCondition && (
        <Text size="xs" color="error">
          Set at least a target date, a target amount, or allow admins to trigger it manually.
        </Text>
      )}
    </div>
  );
}
