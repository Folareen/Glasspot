import { ScheduledLegBuilder } from "./ScheduledLegBuilder";
import { Toggle } from "@/components/ui/Toggle";
import { Divider } from "@/components/ui/Divider";
import { Text } from "@/components/ui/Text";
import type { ScheduledLeg } from "@/lib/mock/types";
import type { WizardState } from "./wizard-types";

type ScheduledConfigStepProps = {
  state: WizardState;
  onChange: (patch: Partial<WizardState>) => void;
  /** Show validation messages. Lifted from the parent wizard page's Continue/Save click, so errors only appear after a submit attempt. */
  showErrors?: boolean;
};

export function ScheduledConfigStep({ state, onChange, showErrors }: ScheduledConfigStepProps) {
  const legs = state.scheduledLegs.length > 0 ? state.scheduledLegs : [
    {
      destinationAccount: "",
      destinationBank: "",
      sequenceOrder: 0,
      amount: "",
      scheduledDate: "",
      firedAt: null,
    },
  ];

  function handleLegsChange(nextLegs: ScheduledLeg[]) {
    onChange({ scheduledLegs: nextLegs });
  }

  return (
    <div className="flex flex-col gap-4">
      <Toggle
        checked={state.scheduledOrdered}
        onChange={(checked) => onChange({ scheduledOrdered: checked })}
        label={
          state.scheduledOrdered
            ? "Pay turns in order (like ajo/esusu)"
            : "Pay each leg independently on its own date"
        }
      />
      <Text size="xs" color="secondary">
        {state.scheduledOrdered
          ? "Each person waits their turn — the next payout only fires once the one before it has gone out, even if its date has already passed."
          : "Every payout fires on its own date regardless of the others — good for staged or installment disbursements."}
      </Text>
      <Divider />
      <ScheduledLegBuilder
        ordered={state.scheduledOrdered}
        legs={legs}
        onChange={handleLegsChange}
        showErrors={showErrors}
      />
    </div>
  );
}
