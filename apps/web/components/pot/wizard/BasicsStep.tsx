import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { Select } from "@/components/ui/Select";
import { nairaAmountToNumber, sanitizeAmountInput } from "@/lib/money";
import type { WizardState } from "./wizard-types";

type BasicsStepProps = {
  state: WizardState;
  onChange: (patch: Partial<WizardState>) => void;
  /** Show validation messages. Lifted from the parent wizard page's Continue/Save click, so errors only appear after a submit attempt, not while the user is still filling the step in. */
  showErrors?: boolean;
};

/** True when a wizard amount field is a non-empty string that parses to a negative number — used to flag negative entries in min/max/goal fields, which are otherwise only screened for "not positive" (0 or blank) by isPositiveAmount elsewhere. */
function isNegativeAmount(raw: string): boolean {
  return Boolean(raw) && nairaAmountToNumber(raw) < 0;
}

export function BasicsStep({ state, onChange, showErrors }: BasicsStepProps) {
  const titleError =
    showErrors && state.title.trim().length === 0 ? "Enter a title for this pot." : undefined;

  const minError = !showErrors
    ? undefined
    : isNegativeAmount(state.minContribution)
      ? "Enter a positive amount."
      : state.minContribution && nairaAmountToNumber(state.minContribution) === 0
        ? "Enter an amount greater than 0, or leave this blank."
        : undefined;

  const maxError = !showErrors
    ? undefined
    : isNegativeAmount(state.maxContribution)
      ? "Enter a positive amount."
      : state.maxContribution && nairaAmountToNumber(state.maxContribution) === 0
        ? "Enter an amount greater than 0, or leave this blank."
        : state.maxContribution &&
            state.minContribution &&
            nairaAmountToNumber(state.maxContribution) < nairaAmountToNumber(state.minContribution)
          ? "The maximum can't be less than the minimum contribution."
          : undefined;

  const goalError = !showErrors
    ? undefined
    : isNegativeAmount(state.goalAmount)
      ? "Enter a positive amount."
      : state.goalAmount && nairaAmountToNumber(state.goalAmount) === 0
        ? "Enter an amount greater than 0, or leave this blank."
        : undefined;

  return (
    <div className="flex flex-col gap-5">
      <Field label="Title" htmlFor="pot-title" required error={titleError}>
        <Input
          id="pot-title"
          value={state.title}
          onChange={(e) => onChange({ title: e.target.value })}
          placeholder="Lagos apartment deposit"
          error={Boolean(titleError)}
        />
      </Field>

      <Field label="Description" htmlFor="pot-description" helperText="Let people know what this pot is for.">
        <Textarea
          id="pot-description"
          value={state.description}
          onChange={(e) => onChange({ description: e.target.value })}
          placeholder="What is this pot for?"
        />
      </Field>

      <Field
        label="Who can see this pot"
        htmlFor="pot-type"
        info="Private pots are only visible to people you add as members. Public pots show up in Explore and anyone can contribute, even without an account."
      >
        <Select
          id="pot-type"
          value={state.potType}
          onChange={(e) => onChange({ potType: e.target.value as WizardState["potType"] })}
        >
          <option value="private">Private, members only</option>
          <option value="public">Public, anyone can view and contribute</option>
        </Select>
      </Field>

      <Field
        label="If the pot doesn't pay out, who gets the money back"
        htmlFor="refund-type"
        info="This only applies if a refund is triggered instead of a payout, for example if a target isn't met, or an admin decides to return the money."
      >
        <Select
          id="refund-type"
          value={state.refundType}
          onChange={(e) => onChange({ refundType: e.target.value as WizardState["refundType"] })}
        >
          <option value="contributors">Each contributor gets their own money back</option>
          <option value="admin">Whichever admin triggers the refund</option>
        </Select>
      </Field>

      <div className="grid grid-cols-2 gap-4">
        <Field
          label="Minimum contribution"
          htmlFor="pot-min"
          helperText="In naira. Leave blank for no minimum, don't enter 0."
          error={minError}
          info="The smallest amount anyone can contribute in a single contribution. Leave blank if you don't want to enforce a minimum."
        >
          <Input
            id="pot-min"
            type="text"
            inputMode="decimal"
            value={state.minContribution}
            onChange={(e) => onChange({ minContribution: sanitizeAmountInput(e.target.value) })}
            placeholder="1000"
            error={Boolean(minError)}
          />
        </Field>
        <Field
          label="Maximum contribution"
          htmlFor="pot-max"
          helperText="Optional. Leave blank for no limit, don't enter 0."
          error={maxError}
          info="The largest amount anyone can contribute in a single contribution. Useful for keeping one person from dominating the pot. Leave blank for no limit."
        >
          <Input
            id="pot-max"
            type="text"
            inputMode="decimal"
            value={state.maxContribution}
            onChange={(e) => onChange({ maxContribution: sanitizeAmountInput(e.target.value) })}
            placeholder="No limit"
            error={Boolean(maxError)}
          />
        </Field>
      </div>

      <Field
        label="Goal amount"
        htmlFor="pot-goal"
        helperText="Optional, shown to contributors as a progress target. Doesn't trigger anything. Leave blank to skip, don't enter 0."
        error={goalError}
        info="This is just a visual target shown to contributors, it never triggers a payout on its own. If you want the payout itself to fire once an amount is reached, use the target amount on the next step instead."
      >
        <Input
          id="pot-goal"
          type="text"
          inputMode="decimal"
          value={state.goalAmount}
          onChange={(e) => onChange({ goalAmount: sanitizeAmountInput(e.target.value) })}
          placeholder="No goal set"
          error={Boolean(goalError)}
        />
      </Field>
    </div>
  );
}
