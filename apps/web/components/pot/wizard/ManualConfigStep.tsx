import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Card } from "@/components/ui/Card";
import { Text } from "@/components/ui/Text";
import { nigerianBanks } from "@/lib/mock/fixtures";
import type { WizardState } from "./wizard-types";

type ManualConfigStepProps = {
  state: WizardState;
  onChange: (patch: Partial<WizardState>) => void;
};

export function ManualConfigStep({ state, onChange }: ManualConfigStepProps) {
  return (
    <div className="flex flex-col gap-5">
      <Card padding="md">
        <Text size="sm" color="secondary">
          Any admin can send the balance whenever they choose, as many times as needed. Every
          payout stays visible to everyone in the pot afterward.
        </Text>
      </Card>

      <div>
        <Text size="sm" weight="medium">
          Payout account
        </Text>
        <Text size="xs" color="secondary" className="mt-0.5">
          Optional. Set one now if the group already knows where the money should go — admins can
          still trigger payout whenever they choose. Leave both blank to have the triggering admin
          pick the account each time instead.
        </Text>
      </div>

      <Field label="Payout account number" htmlFor="manual-account" helperText="Optional">
        <Input
          id="manual-account"
          inputMode="numeric"
          maxLength={10}
          value={state.manualDestinationAccount}
          onChange={(e) => onChange({ manualDestinationAccount: e.target.value })}
          placeholder="0123456789"
        />
      </Field>

      <Field label="Payout bank" htmlFor="manual-bank" helperText="Optional">
        <Select
          id="manual-bank"
          value={state.manualDestinationBank}
          onChange={(e) => onChange({ manualDestinationBank: e.target.value })}
        >
          <option value="">Select a bank</option>
          {nigerianBanks.map((bank) => (
            <option key={bank.code} value={bank.code}>
              {bank.name}
            </option>
          ))}
        </Select>
      </Field>
    </div>
  );
}
