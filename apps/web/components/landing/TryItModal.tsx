"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/Modal";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { Text } from "@/components/ui/Text";
import { Spinner } from "@/components/ui/Spinner";
import { useMockStore } from "@/lib/mock/store";
import { useToast } from "@/lib/toast";
import { saveDraftPot } from "@/lib/draftPot";
import { buildPayoutConfig, isPositiveAmount } from "@/components/pot/wizard/wizard-helpers";
import { toNairaAmount } from "@/lib/money";
import { buildTemplateFromUseCase, payoutModeMeta, type UseCase } from "./use-cases-data";
import type { WizardState } from "@/components/pot/wizard/wizard-types";

type TryItModalProps = {
  open: boolean;
  onClose: () => void;
  useCase: UseCase | null;
};

export function TryItModal({ open, onClose, useCase }: TryItModalProps) {
  const router = useRouter();
  const { isAuthenticated, createPot } = useMockStore();
  const { showToast } = useToast();
  const [state, setState] = useState<WizardState | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const activeState = state ?? (useCase ? buildTemplateFromUseCase(useCase) : null);

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      setState(null);
      onClose();
    }
  }

  function patch(update: Partial<WizardState>) {
    if (!activeState) return;
    setState({ ...activeState, ...update });
  }

  function handleCreate() {
    if (!activeState || !activeState.title.trim()) return;

    if (!isAuthenticated) {
      saveDraftPot(activeState);
      router.push("/signup");
      return;
    }

    setIsSubmitting(true);
    const pot = createPot({
      title: activeState.title.trim(),
      description: activeState.description.trim() || undefined,
      potType: activeState.potType,
      refundType: activeState.refundType,
      minContribution: isPositiveAmount(activeState.minContribution)
        ? (toNairaAmount(activeState.minContribution) ?? undefined)
        : undefined,
      maxContribution: isPositiveAmount(activeState.maxContribution)
        ? (toNairaAmount(activeState.maxContribution) ?? undefined)
        : undefined,
      goalAmount: isPositiveAmount(activeState.goalAmount)
        ? (toNairaAmount(activeState.goalAmount) ?? undefined)
        : undefined,
      payoutMode: activeState.payoutMode ?? "manual",
      payoutConfig: buildPayoutConfig(activeState),
    });
    setIsSubmitting(false);
    showToast("Pot created as a draft", "success");
    handleOpenChange(false);
    router.push(`/pots/${pot.id}/edit`);
  }

  return (
    <Modal
      open={open}
      onClose={() => handleOpenChange(false)}
      title={useCase ? `Try it: ${useCase.title}` : undefined}
    >
      {activeState && useCase && (
        <div className="flex flex-col gap-4">
          <Text size="sm" color="secondary">
            This is a starting template, not a locked-in choice. Everything here is editable, and
            you can change the rest before your pot goes live.
          </Text>

          <Field label="Pot name" htmlFor="try-it-title">
            <Input
              id="try-it-title"
              value={activeState.title}
              onChange={(e) => patch({ title: e.target.value })}
            />
          </Field>

          <Field
            label="Payout rule"
            htmlFor="try-it-mode"
            info="How the pot decides when to pay out. You can pick a different rule once you're in the full editor."
          >
            <Select
              id="try-it-mode"
              value={activeState.payoutMode ?? "manual"}
              onChange={(e) => patch({ payoutMode: e.target.value as WizardState["payoutMode"] })}
            >
              {(Object.keys(payoutModeMeta) as (keyof typeof payoutModeMeta)[]).map((mode) => (
                <option key={mode} value={mode}>
                  {payoutModeMeta[mode].label}
                </option>
              ))}
            </Select>
          </Field>

          {activeState.payoutMode === "target_based" && (
            <Field label="Target amount" htmlFor="try-it-target-amount" helperText="In naira. You can edit this later.">
              <Input
                id="try-it-target-amount"
                type="number"
                inputMode="decimal"
                min={0}
                value={activeState.targetAmountNaira}
                onChange={(e) => patch({ targetAmountNaira: e.target.value })}
              />
            </Field>
          )}

          {activeState.payoutMode === "recurring" && (
            <Field label="Amount per payout" htmlFor="try-it-recurring-amount" helperText="In naira. You can edit this later.">
              <Input
                id="try-it-recurring-amount"
                type="number"
                inputMode="decimal"
                min={0}
                value={activeState.recurringAmountNaira}
                onChange={(e) => patch({ recurringAmountNaira: e.target.value })}
              />
            </Field>
          )}

          <Field
            label="Who gets the money back if it doesn't pay out"
            htmlFor="try-it-refund-type"
          >
            <Select
              id="try-it-refund-type"
              value={activeState.refundType}
              onChange={(e) => patch({ refundType: e.target.value as WizardState["refundType"] })}
            >
              <option value="contributors">Each contributor gets their own money back</option>
              <option value="admin">Whichever admin triggers the refund</option>
            </Select>
          </Field>

          <Button className="w-full" onClick={handleCreate} disabled={!activeState.title.trim() || isSubmitting}>
            {isSubmitting && <Spinner size="sm" />}
            {isAuthenticated ? "Create this pot" : "Continue to create this pot"}
          </Button>
        </div>
      )}
    </Modal>
  );
}
