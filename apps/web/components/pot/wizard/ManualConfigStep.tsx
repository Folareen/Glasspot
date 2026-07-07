import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Card } from "@/components/ui/Card";
import { Text } from "@/components/ui/Text";
import { Spinner } from "@/components/ui/Spinner";
import { useBanks } from "@/lib/useBanks";
import { useBankAccountLookup } from "@/lib/useBankAccountLookup";
import type { WizardState } from "./wizard-types";

type ManualConfigStepProps = {
  state: WizardState;
  onChange: (patch: Partial<WizardState>) => void;
  /** Show validation messages. Lifted from the parent wizard page's Continue/Save click, so errors only appear after a submit attempt. */
  showErrors?: boolean;
};

export function ManualConfigStep({ state, onChange, showErrors }: ManualConfigStepProps) {
  const { banks } = useBanks();
  // Both-or-neither, mirroring isConfigStepValid (wizard-helpers.ts): the
  // destination is optional, but if the user has started filling in one
  // half, flag the other half as the thing missing rather than staying
  // silent until they notice Continue is disabled.
  const accountError =
    showErrors && state.manualDestinationBank && !state.manualDestinationAccount
      ? "Add an account number too."
      : undefined;
  const bankError =
    showErrors && state.manualDestinationAccount && !state.manualDestinationBank
      ? "Add a bank too."
      : undefined;
  const {
    confirmedName,
    isLookingUp,
    error: lookupError,
  } = useBankAccountLookup(state.manualDestinationAccount, state.manualDestinationBank);

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

      <Field
        label="Payout account number"
        htmlFor="manual-account"
        helperText={accountError ? undefined : "Optional"}
        error={accountError}
      >
        <Input
          id="manual-account"
          inputMode="numeric"
          maxLength={10}
          value={state.manualDestinationAccount}
          onChange={(e) => onChange({ manualDestinationAccount: e.target.value })}
          placeholder="0123456789"
          error={Boolean(accountError)}
        />
      </Field>

      <Field
        label="Payout bank"
        htmlFor="manual-bank"
        helperText={bankError ? undefined : "Optional"}
        error={bankError}
      >
        <Select
          id="manual-bank"
          value={state.manualDestinationBank}
          onChange={(e) => onChange({ manualDestinationBank: e.target.value })}
          error={Boolean(bankError)}
          searchable
          searchPlaceholder="Search banks..."
        >
          <option value="">Select a bank</option>
          {banks.map((bank) => (
            <option key={bank.code} value={bank.code}>
              {bank.name}
            </option>
          ))}
        </Select>
      </Field>

      {isLookingUp && (
        <div className="flex items-center gap-2">
          <Spinner size="sm" />
          <Text size="sm" color="secondary">
            Verifying account...
          </Text>
        </div>
      )}

      {confirmedName && !isLookingUp && (
        <Field label="Account name">
          <Text weight="medium">{confirmedName}</Text>
        </Field>
      )}

      {lookupError && !isLookingUp && (
        <Text size="sm" color="error">
          {lookupError}
        </Text>
      )}
    </div>
  );
}
