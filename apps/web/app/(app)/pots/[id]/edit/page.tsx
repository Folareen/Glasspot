"use client";

import { use, useEffect, useState } from "react";
import { notFound, useRouter } from "next/navigation";
import { AppHeader } from "@/components/layout/AppHeader";
import { Container } from "@/components/ui/Container";
import { Button } from "@/components/ui/Button";
import { Text } from "@/components/ui/Text";
import { useMockStore } from "@/lib/mock/store";
import { useToast } from "@/lib/toast";
import { BasicsStep } from "@/components/pot/wizard/BasicsStep";
import { PayoutModeStep } from "@/components/pot/wizard/PayoutModeStep";
import { TargetBasedConfigStep } from "@/components/pot/wizard/TargetBasedConfigStep";
import { ManualConfigStep } from "@/components/pot/wizard/ManualConfigStep";
import { RecurringConfigStep } from "@/components/pot/wizard/RecurringConfigStep";
import { RotationConfigStep } from "@/components/pot/wizard/RotationConfigStep";
import { potToWizardState } from "@/components/pot/wizard/pot-to-wizard-state";
import { buildPayoutConfig, toKobo } from "@/components/pot/wizard/wizard-helpers";
import type { WizardState } from "@/components/pot/wizard/wizard-types";

type EditPotPageProps = {
  params: Promise<{ id: string }>;
};

export default function EditPotPage({ params }: EditPotPageProps) {
  const { id } = use(params);
  const router = useRouter();
  const { showToast } = useToast();
  const { getPot, updatePot } = useMockStore();

  const pot = getPot(id);
  if (!pot) notFound();

  const [state, setState] = useState<WizardState>(() => potToWizardState(pot));
  const isDraft = pot.status === "draft";

  useEffect(() => {
    if (!isDraft) {
      router.replace(`/pots/${id}`);
    }
  }, [isDraft, id, router]);

  if (!isDraft) {
    return null;
  }

  function patch(update: Partial<WizardState>) {
    setState((prev) => ({ ...prev, ...update }));
  }

  function handleSave() {
    if (!state.payoutMode) return;
    updatePot(id, {
      title: state.title.trim(),
      description: state.description.trim() || undefined,
      minContributionKobo: state.minContributionKobo ? toKobo(state.minContributionKobo) : undefined,
      maxContributionKobo: state.maxContributionKobo ? toKobo(state.maxContributionKobo) : undefined,
      payoutMode: state.payoutMode,
      payoutConfig: buildPayoutConfig(state),
    });
    showToast("Draft updated", "success");
    router.push(`/pots/${id}`);
  }

  return (
    <div>
      <AppHeader title="Edit draft" backHref={`/pots/${pot.id}`} />
      <Container className="max-w-2xl py-6">
        <Text size="sm" color="secondary" className="mb-6">
          You can change anything about this pot while it&apos;s still a draft. Once you open it,
          the payout rule is locked in.
        </Text>

        <div className="flex flex-col gap-8">
          <BasicsStep state={state} onChange={patch} />

          <div>
            <Text weight="semibold" className="mb-3">
              Payout mode
            </Text>
            <PayoutModeStep value={state.payoutMode} onChange={(mode) => patch({ payoutMode: mode })} />
          </div>

          {state.payoutMode === "target_based" && <TargetBasedConfigStep state={state} onChange={patch} />}
          {state.payoutMode === "manual" && <ManualConfigStep />}
          {state.payoutMode === "recurring" && <RecurringConfigStep state={state} onChange={patch} />}
          {state.payoutMode === "rotation" && <RotationConfigStep state={state} onChange={patch} />}
        </div>

        <Button className="mt-8 w-full" onClick={handleSave} disabled={!state.title.trim() || !state.payoutMode}>
          Save changes
        </Button>
      </Container>
    </div>
  );
}
