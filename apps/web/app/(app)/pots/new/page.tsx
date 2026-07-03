"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { AppHeader } from "@/components/layout/AppHeader";
import { Container } from "@/components/ui/Container";
import { Button } from "@/components/ui/Button";
import { Text } from "@/components/ui/Text";
import { Spinner } from "@/components/ui/Spinner";
import { useToast } from "@/lib/toast";
import { useMockStore } from "@/lib/mock/store";
import { BasicsStep } from "@/components/pot/wizard/BasicsStep";
import { PayoutModeStep } from "@/components/pot/wizard/PayoutModeStep";
import { TargetBasedConfigStep } from "@/components/pot/wizard/TargetBasedConfigStep";
import { ManualConfigStep } from "@/components/pot/wizard/ManualConfigStep";
import { RecurringConfigStep } from "@/components/pot/wizard/RecurringConfigStep";
import { RotationConfigStep } from "@/components/pot/wizard/RotationConfigStep";
import { ReviewStep } from "@/components/pot/wizard/ReviewStep";
import { initialWizardState, wizardSteps, type WizardState } from "@/components/pot/wizard/wizard-types";
import { buildPayoutConfig, isConfigStepValid, toKobo } from "@/components/pot/wizard/wizard-helpers";

const stepTitles: Record<(typeof wizardSteps)[number], string> = {
  basics: "Create a pot",
  mode: "Choose a payout rule",
  config: "Set up the payout",
  review: "Review and create",
};

export default function NewPotPage() {
  const router = useRouter();
  const { showToast } = useToast();
  const { createPot } = useMockStore();
  const [stepIndex, setStepIndex] = useState(0);
  const [state, setState] = useState<WizardState>(initialWizardState);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const step = wizardSteps[stepIndex];

  function patch(update: Partial<WizardState>) {
    setState((prev) => ({ ...prev, ...update }));
  }

  function canAdvance() {
    if (step === "basics") return state.title.trim().length > 0;
    if (step === "mode") return state.payoutMode !== null;
    if (step === "config") return isConfigStepValid(state);
    return true;
  }

  function goBack() {
    if (stepIndex === 0) {
      router.push("/dashboard");
      return;
    }
    setStepIndex((i) => i - 1);
  }

  function goNext() {
    if (stepIndex < wizardSteps.length - 1) {
      setStepIndex((i) => i + 1);
    }
  }

  function handleCreate() {
    if (!state.payoutMode) return;
    setIsSubmitting(true);
    const pot = createPot({
      title: state.title.trim(),
      description: state.description.trim() || undefined,
      potType: state.potType,
      refundType: state.refundType,
      minContributionKobo: state.minContributionKobo ? toKobo(state.minContributionKobo) : undefined,
      maxContributionKobo: state.maxContributionKobo ? toKobo(state.maxContributionKobo) : undefined,
      payoutMode: state.payoutMode,
      payoutConfig: buildPayoutConfig(state),
    });
    showToast("Pot created as a draft", "success");
    router.push(`/pots/${pot.id}`);
  }

  return (
    <div>
      <AppHeader title={stepTitles[step]} action={<StepIndicator index={stepIndex} />} />
      <Container className="max-w-2xl py-6">
        <button
          type="button"
          onClick={goBack}
          className="mb-4 flex items-center gap-1 text-sm font-medium text-text-secondary transition-colors duration-150 hover:text-text-primary"
        >
          <ArrowLeft className="h-4 w-4" strokeWidth={1.5} />
          Back
        </button>

        {step === "basics" && <BasicsStep state={state} onChange={patch} />}
        {step === "mode" && (
          <PayoutModeStep value={state.payoutMode} onChange={(mode) => patch({ payoutMode: mode })} />
        )}
        {step === "config" && state.payoutMode === "target_based" && (
          <TargetBasedConfigStep state={state} onChange={patch} />
        )}
        {step === "config" && state.payoutMode === "manual" && (
          <ManualConfigStep />
        )}
        {step === "config" && state.payoutMode === "recurring" && (
          <RecurringConfigStep state={state} onChange={patch} />
        )}
        {step === "config" && state.payoutMode === "rotation" && (
          <RotationConfigStep state={state} onChange={patch} />
        )}
        {step === "review" && <ReviewStep state={state} />}

        <div className="mt-8">
          {step === "review" ? (
            <Button className="w-full" onClick={handleCreate} disabled={isSubmitting}>
              {isSubmitting && <Spinner size="sm" />}
              Create pot
            </Button>
          ) : (
            <Button className="w-full" onClick={goNext} disabled={!canAdvance()}>
              Continue
              <ArrowRight className="h-4 w-4" strokeWidth={1.5} />
            </Button>
          )}
        </div>
      </Container>
    </div>
  );
}

function StepIndicator({ index }: { index: number }) {
  return (
    <Text size="xs" color="secondary">
      Step {index + 1} of {wizardSteps.length}
    </Text>
  );
}
