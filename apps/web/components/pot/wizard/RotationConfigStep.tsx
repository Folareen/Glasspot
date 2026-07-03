import { RotationLegBuilder } from "./RotationLegBuilder";
import type { RotationLeg } from "@/lib/mock/types";
import type { WizardState } from "./wizard-types";

type RotationConfigStepProps = {
  state: WizardState;
  onChange: (patch: Partial<WizardState>) => void;
};

export function RotationConfigStep({ state, onChange }: RotationConfigStepProps) {
  const legs = state.rotationLegs.length > 0 ? state.rotationLegs : [
    {
      destinationAccount: "",
      destinationBank: "",
      sequenceOrder: 0,
      amountKobo: "",
      scheduledDate: "",
      firedAt: null,
    },
  ];

  function handleChange(nextLegs: RotationLeg[]) {
    onChange({ rotationLegs: nextLegs });
  }

  return <RotationLegBuilder legs={legs} onChange={handleChange} />;
}
