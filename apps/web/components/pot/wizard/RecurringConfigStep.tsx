import { useEffect } from "react";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Text } from "@/components/ui/Text";
import { Spinner } from "@/components/ui/Spinner";
import { useBanks } from "@/lib/useBanks";
import { useBankAccountLookup } from "@/lib/useBankAccountLookup";
import { addNaira, formatNaira, OUTBOUND_FEE, sanitizeAmountInput, toNairaAmount } from "@/lib/money";
import { isPositiveAmount, isValidIntervalDays } from "./wizard-helpers";
import type { WizardState } from "./wizard-types";

type RecurringConfigStepProps = {
  state: WizardState;
  onChange: (patch: Partial<WizardState>) => void;
  /** Show validation messages. Lifted from the parent wizard page's Continue/Save click, so errors only appear after a submit attempt. */
  showErrors?: boolean;
};

export function RecurringConfigStep({ state, onChange, showErrors }: RecurringConfigStepProps) {
  const { banks } = useBanks();
  const {
    confirmedName,
    isLookingUp,
    error: lookupError,
  } = useBankAccountLookup(state.recurringDestinationAccount, state.recurringDestinationBank);

  // See TargetBasedConfigStep.tsx's identical sync effect for why this is needed.
  useEffect(() => {
    if (state.recurringDestinationConfirmedName !== confirmedName) {
      onChange({ recurringDestinationConfirmedName: confirmedName });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only confirmedName changing should re-sync; onChange/state aren't independent triggers here.
  }, [confirmedName]);

  // Errors mirror isConfigStepValid's "recurring" case (wizard-helpers.ts)
  // field for field, so a message only shows for whichever condition that
  // rule is actually failing on.
  const accountError =
    showErrors && !state.recurringDestinationAccount
      ? "Enter the payout account number."
      : showErrors && state.recurringDestinationAccount && state.recurringDestinationBank && !confirmedName
        ? "Wait for the account name to be confirmed."
        : undefined;
  const bankError = showErrors && !state.recurringDestinationBank ? "Choose the payout bank." : undefined;
  const amountError =
    showErrors && !isPositiveAmount(state.recurringAmountNaira) ? "Enter an amount greater than 0." : undefined;
  const intervalError =
    showErrors && !isValidIntervalDays(state.recurringIntervalDays)
      ? "Enter how many days between payouts. Must be at least 1."
      : undefined;
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
          onChange={(e) => onChange({ recurringDestinationAccount: e.target.value.replace(/\D/g, "") })}
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

      <Field
        label="Amount per payout"
        htmlFor="recurring-amount"
        helperText={amountError ? undefined : "In naira. Must be greater than 0. The recipient gets exactly this amount each time."}
        required
        error={amountError}
      >
        <Input
          id="recurring-amount"
          type="text"
          inputMode="decimal"
          value={state.recurringAmountNaira}
          onChange={(e) => onChange({ recurringAmountNaira: sanitizeAmountInput(e.target.value) })}
          placeholder="1000"
          error={Boolean(amountError)}
        />
      </Field>

      {isPositiveAmount(state.recurringAmountNaira) && (
        <Text size="xs" color="secondary">
          Pot needs {formatNaira(addNaira(toNairaAmount(state.recurringAmountNaira)!, OUTBOUND_FEE))} available each
          time this fires — {formatNaira(toNairaAmount(state.recurringAmountNaira)!)} to the recipient plus the{" "}
          {formatNaira(OUTBOUND_FEE)} payout fee.
        </Text>
      )}

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
          type="text"
          inputMode="numeric"
          value={state.recurringIntervalDays}
          onChange={(e) => onChange({ recurringIntervalDays: e.target.value.replace(/\D/g, "") })}
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
