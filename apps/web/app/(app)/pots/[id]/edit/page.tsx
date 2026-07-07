"use client";

import { use, useEffect, useState } from "react";
import { notFound, useRouter } from "next/navigation";
import { AppHeader } from "@/components/layout/AppHeader";
import { PageHeading } from "@/components/layout/PageHeading";
import { Container } from "@/components/ui/Container";
import { Button } from "@/components/ui/Button";
import { Text } from "@/components/ui/Text";
import { Spinner } from "@/components/ui/Spinner";
import { ApiError, getPot, updatePot } from "@/lib/api";
import { useToast } from "@/lib/toast";
import { BasicsStep } from "@/components/pot/wizard/BasicsStep";
import { PayoutModeStep } from "@/components/pot/wizard/PayoutModeStep";
import { TargetBasedConfigStep } from "@/components/pot/wizard/TargetBasedConfigStep";
import { ManualConfigStep } from "@/components/pot/wizard/ManualConfigStep";
import { RecurringConfigStep } from "@/components/pot/wizard/RecurringConfigStep";
import { ScheduledConfigStep } from "@/components/pot/wizard/ScheduledConfigStep";
import { ReviewStep } from "@/components/pot/wizard/ReviewStep";
import { potToWizardState } from "@/components/pot/wizard/pot-to-wizard-state";
import { buildPayoutConfig, isPositiveAmount } from "@/components/pot/wizard/wizard-helpers";
import { toNairaAmount } from "@/lib/money";
import type { WizardState } from "@/components/pot/wizard/wizard-types";
import type { PotResponse } from "@/lib/types";
import { Tabs } from "@/components/ui/Tabs";

type EditPotPageProps = {
  params: Promise<{ id: string }>;
};

export default function EditPotPage({ params }: EditPotPageProps) {
  const { id } = use(params);
  const router = useRouter();
  const { showToast } = useToast();

  const [pot, setPot] = useState<PotResponse | null | undefined>(undefined);
  const [state, setState] = useState<WizardState | null>(null);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    getPot(id)
      .then((data) => {
        setPot(data);
        setState(potToWizardState(data));
      })
      .catch((e) => {
        if (e instanceof ApiError && e.status === 404) {
          setPot(null);
          return;
        }
        showToast(e instanceof ApiError ? e.message : "Couldn't load this pot", "error");
      });
  }, [id, showToast]);

  const isDraft = pot?.status === "draft";

  useEffect(() => {
    if (pot && !isDraft) {
      router.replace(`/pots/${id}`);
    }
  }, [pot, isDraft, id, router]);

  if (pot === undefined || state === null) {
    return (
      <div className="flex justify-center py-16">
        <Spinner size="md" />
      </div>
    );
  }
  if (pot === null) notFound();
  if (!isDraft) return null;

  function patch(update: Partial<WizardState>) {
    setState((prev) => (prev ? { ...prev, ...update } : prev));
  }

  async function handleSave() {
    if (!state || !state.title.trim() || !state.payoutMode) {
      setSubmitAttempted(true);
      return;
    }
    setIsSubmitting(true);
    try {
      await updatePot(id, {
        title: state.title.trim(),
        description: state.description.trim() || undefined,
        minContribution: isPositiveAmount(state.minContribution) ? (toNairaAmount(state.minContribution) ?? undefined) : undefined,
        maxContribution: isPositiveAmount(state.maxContribution) ? (toNairaAmount(state.maxContribution) ?? undefined) : undefined,
        goalAmount: isPositiveAmount(state.goalAmount) ? (toNairaAmount(state.goalAmount) ?? undefined) : undefined,
        payoutMode: state.payoutMode,
        payoutConfig: buildPayoutConfig(state),
      });
      showToast("Draft updated", "success");
      router.push(`/pots/${id}`);
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : "Couldn't save changes", "error");
      setIsSubmitting(false);
    }
  }

  return (
    <div>
      <AppHeader title="Edit draft" backHref={`/pots/${id}`} />
      <Container maxWidth="2xl" className="py-6 lg:py-10">
        <PageHeading title="Edit draft" backHref={`/pots/${id}`} className="mb-6 hidden lg:block" />
        <Text size="sm" color="secondary" className="mb-6">
          You can change anything about this pot while it&apos;s still a draft. Once you open it,
          the payout and refund rules are locked in.
        </Text>

        <Tabs tabs={[{ id: "edit", label: "Edit" }, { id: "preview", label: "Preview" }]}>
          {(activeTabId) =>
            activeTabId === "preview" ? (
              <ReviewStep state={state} />
            ) : (
              <div className="flex flex-col gap-8">
                <BasicsStep state={state} onChange={patch} showErrors={submitAttempted} />

                <div>
                  <Text weight="semibold" className="mb-3">
                    Payout mode
                  </Text>
                  <PayoutModeStep value={state.payoutMode} onChange={(mode) => patch({ payoutMode: mode })} />
                </div>

                {state.payoutMode === "target_based" && (
                  <TargetBasedConfigStep state={state} onChange={patch} showErrors={submitAttempted} />
                )}
                {state.payoutMode === "manual" && (
                  <ManualConfigStep state={state} onChange={patch} showErrors={submitAttempted} />
                )}
                {state.payoutMode === "recurring" && (
                  <RecurringConfigStep state={state} onChange={patch} showErrors={submitAttempted} />
                )}
                {state.payoutMode === "scheduled" && (
                  <ScheduledConfigStep state={state} onChange={patch} showErrors={submitAttempted} />
                )}
              </div>
            )
          }
        </Tabs>

        <Button className="mt-8 w-full" onClick={handleSave} disabled={isSubmitting}>
          {isSubmitting && <Spinner size="sm" />}
          Save changes
        </Button>
      </Container>
    </div>
  );
}
