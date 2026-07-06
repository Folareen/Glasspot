import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { Select } from "@/components/ui/Select";
import { Text } from "@/components/ui/Text";
import type { WizardState } from "./wizard-types";

type BasicsStepProps = {
  state: WizardState;
  onChange: (patch: Partial<WizardState>) => void;
};

export function BasicsStep({ state, onChange }: BasicsStepProps) {
  return (
    <div className="flex flex-col gap-5">
      <Field label="Title" htmlFor="pot-title" required>
        <Input
          id="pot-title"
          value={state.title}
          onChange={(e) => onChange({ title: e.target.value })}
          placeholder="Lagos apartment deposit"
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

      <Field label="Who can see this pot" htmlFor="pot-type">
        <Select
          id="pot-type"
          value={state.potType}
          onChange={(e) => onChange({ potType: e.target.value as WizardState["potType"] })}
        >
          <option value="private">Private, members only</option>
          <option value="public">Public, anyone can view and contribute</option>
        </Select>
      </Field>

      <div className="flex flex-col gap-2">
        <Text size="sm" weight="medium">
          If the pot doesn&apos;t pay out, who gets the money back
        </Text>
        <Select
          id="refund-type"
          value={state.refundType}
          onChange={(e) => onChange({ refundType: e.target.value as WizardState["refundType"] })}
        >
          <option value="contributors">Each contributor gets their own money back</option>
          <option value="admin">Whichever admin triggers the refund</option>
        </Select>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Minimum contribution" htmlFor="pot-min" helperText="In naira">
          <Input
            id="pot-min"
            type="number"
            inputMode="decimal"
            min={0}
            value={state.minContribution}
            onChange={(e) => onChange({ minContribution: e.target.value })}
            placeholder="1000"
          />
        </Field>
        <Field label="Maximum contribution" htmlFor="pot-max" helperText="Optional">
          <Input
            id="pot-max"
            type="number"
            inputMode="decimal"
            min={0}
            value={state.maxContribution}
            onChange={(e) => onChange({ maxContribution: e.target.value })}
            placeholder="No limit"
          />
        </Field>
      </div>
    </div>
  );
}
