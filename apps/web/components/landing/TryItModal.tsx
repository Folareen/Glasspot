"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/Modal";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { Text } from "@/components/ui/Text";
import { Spinner } from "@/components/ui/Spinner";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/lib/toast";
import { ApiError, createPot } from "@/lib/api";
import { saveDraftPot } from "@/lib/draftPot";
import { useBanks } from "@/lib/useBanks";
import { useBankAccountLookup } from "@/lib/useBankAccountLookup";
import { buildPayoutConfig, isConfigStepValid, isPositiveAmount } from "@/components/pot/wizard/wizard-helpers";
import { sanitizeAmountInput, toNairaAmount } from "@/lib/money";
import { buildTemplateFromUseCase, payoutModeMeta, type UseCase } from "./use-cases-data";
import type { WizardState } from "@/components/pot/wizard/wizard-types";

type TryItModalProps = {
  open: boolean;
  onClose: () => void;
  useCase: UseCase | null;
};

/** Reads the one destination account+bank pair relevant to state's current payout mode, or null for a mode (manual) with no destination requirement. Scheduled only ever has one leg here — TryItModal's templates always start with exactly one. */
function readDestination(state: WizardState): { account: string; bank: string } | null {
  switch (state.payoutMode) {
    case "target_based":
      return { account: state.targetDestinationAccount, bank: state.targetDestinationBank };
    case "recurring":
      return { account: state.recurringDestinationAccount, bank: state.recurringDestinationBank };
    case "scheduled":
      return { account: state.scheduledLegs[0]?.destinationAccount ?? "", bank: state.scheduledLegs[0]?.destinationBank ?? "" };
    default:
      return null;
  }
}

/** The state patch to write a new account/bank/confirmedName value back to whichever field(s) readDestination read from — confirmedName mirrors useBankAccountLookup's own return value so isConfigStepValid (wizard-helpers.ts) can require a confirmed destination, same as every real wizard step. */
function patchDestination(
  state: WizardState,
  next: { account?: string; bank?: string; confirmedName?: string | null }
): Partial<WizardState> {
  switch (state.payoutMode) {
    case "target_based":
      return {
        ...(next.account !== undefined ? { targetDestinationAccount: next.account } : {}),
        ...(next.bank !== undefined ? { targetDestinationBank: next.bank } : {}),
        ...(next.confirmedName !== undefined ? { targetDestinationConfirmedName: next.confirmedName } : {}),
      };
    case "recurring":
      return {
        ...(next.account !== undefined ? { recurringDestinationAccount: next.account } : {}),
        ...(next.bank !== undefined ? { recurringDestinationBank: next.bank } : {}),
        ...(next.confirmedName !== undefined ? { recurringDestinationConfirmedName: next.confirmedName } : {}),
      };
    case "scheduled": {
      const [firstLeg, ...restLegs] = state.scheduledLegs;
      return {
        scheduledLegs: [
          {
            ...firstLeg,
            ...(next.account !== undefined ? { destinationAccount: next.account } : {}),
            ...(next.bank !== undefined ? { destinationBank: next.bank } : {}),
            ...(next.confirmedName !== undefined ? { destinationConfirmedName: next.confirmedName } : {}),
          },
          ...restLegs,
        ],
      };
    }
    default:
      return {};
  }
}

/** Reads back whichever field patchDestination's confirmedName branch wrote, for the sync effect's change check. */
function readDestinationConfirmedName(state: WizardState): string | null {
  switch (state.payoutMode) {
    case "target_based":
      return state.targetDestinationConfirmedName;
    case "recurring":
      return state.recurringDestinationConfirmedName;
    case "scheduled":
      return state.scheduledLegs[0]?.destinationConfirmedName ?? null;
    default:
      return null;
  }
}

export function TryItModal({ open, onClose, useCase }: TryItModalProps) {
  const router = useRouter();
  const { currentUser } = useAuth();
  const { showToast } = useToast();
  const { banks } = useBanks();
  const isAuthenticated = currentUser !== null;
  const [state, setState] = useState<WizardState | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showErrors, setShowErrors] = useState(false);

  const activeState = state ?? (useCase ? buildTemplateFromUseCase(useCase) : null);
  const destination = activeState ? readDestination(activeState) : null;
  const { confirmedName, isLookingUp, error: lookupError } = useBankAccountLookup(
    destination?.account ?? "",
    destination?.bank ?? ""
  );

  // Lifts confirmedName into wizard state so isConfigStepValid can require it — see
  // TargetBasedConfigStep.tsx's identical sync effect for the full rationale.
  useEffect(() => {
    if (!activeState || !destination) return;
    if (readDestinationConfirmedName(activeState) !== confirmedName) {
      patch(patchDestination(activeState, { confirmedName }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only confirmedName changing should re-sync.
  }, [confirmedName]);

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      setState(null);
      setShowErrors(false);
      onClose();
    }
  }

  function patch(update: Partial<WizardState>) {
    if (!activeState) return;
    setState({ ...activeState, ...update });
  }

  function patchDestinationField(next: { account?: string; bank?: string }) {
    if (!activeState) return;
    patch(patchDestination(activeState, next));
  }

  async function handleCreate() {
    if (!activeState || !activeState.title.trim()) return;
    if (!isConfigStepValid(activeState)) {
      setShowErrors(true);
      return;
    }

    if (!isAuthenticated) {
      saveDraftPot(activeState);
      router.push("/signup");
      return;
    }

    setIsSubmitting(true);
    try {
      const pot = await createPot({
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
      showToast("Pot created as a draft", "success");
      handleOpenChange(false);
      router.push(`/pots/${pot.id}/edit`);
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : "Couldn't create this pot", "error");
      setIsSubmitting(false);
      return;
    }
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

          {destination && (
            <>
              <Text size="xs" color="secondary">
                This creates a real draft pot — nothing pays out yet, but we need a real payout
                account to set it up. You can change it any time before the pot goes live.
              </Text>

              <Field
                label="Payout account number"
                htmlFor="try-it-destination-account"
                required
                error={showErrors && !destination.account ? "Enter the payout account number." : undefined}
              >
                <Input
                  id="try-it-destination-account"
                  inputMode="numeric"
                  maxLength={10}
                  value={destination.account}
                  onChange={(e) => patchDestinationField({ account: e.target.value })}
                  placeholder="0123456789"
                  error={showErrors && !destination.account}
                />
              </Field>

              <Field
                label="Payout bank"
                htmlFor="try-it-destination-bank"
                required
                error={showErrors && !destination.bank ? "Choose the payout bank." : undefined}
              >
                <Select
                  id="try-it-destination-bank"
                  value={destination.bank}
                  onChange={(e) => patchDestinationField({ bank: e.target.value })}
                  error={showErrors && !destination.bank}
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
            </>
          )}

          {activeState.payoutMode === "target_based" && (
            <Field label="Target amount" htmlFor="try-it-target-amount" helperText="In naira. You can edit this later.">
              <Input
                id="try-it-target-amount"
                type="text"
                inputMode="decimal"
                value={activeState.targetAmountNaira}
                onChange={(e) => patch({ targetAmountNaira: sanitizeAmountInput(e.target.value) })}
              />
            </Field>
          )}

          {activeState.payoutMode === "recurring" && (
            <Field label="Amount per payout" htmlFor="try-it-recurring-amount" helperText="In naira. You can edit this later.">
              <Input
                id="try-it-recurring-amount"
                type="text"
                inputMode="decimal"
                value={activeState.recurringAmountNaira}
                onChange={(e) => patch({ recurringAmountNaira: sanitizeAmountInput(e.target.value) })}
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
