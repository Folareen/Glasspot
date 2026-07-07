"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { OtpInput } from "@/components/auth/OtpInput";
import { useResendTimer } from "@/components/auth/useResendTimer";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { Text } from "@/components/ui/Text";
import { useMockStore } from "@/lib/mock/store";
import { useToast } from "@/lib/toast";
import { getDraftPot, clearDraftPot } from "@/lib/draftPot";
import { buildPayoutConfig, isPositiveAmount } from "@/components/pot/wizard/wizard-helpers";
import { toNairaAmount } from "@/lib/money";

type OtpVerifyFormProps = {
  email: string;
  successMessage: string;
};

export function OtpVerifyForm({ email, successMessage }: OtpVerifyFormProps) {
  const router = useRouter();
  const { login, createPot } = useMockStore();
  const { showToast } = useToast();
  const { secondsLeft, label, reset } = useResendTimer();
  const [code, setCode] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showError, setShowError] = useState(false);

  const isComplete = code.length === 6;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isComplete) {
      setShowError(true);
      return;
    }
    setShowError(false);
    setIsSubmitting(true);
    setTimeout(() => {
      login();
      showToast(successMessage, "success");

      const draft = getDraftPot();
      if (draft && draft.title.trim()) {
        const pot = createPot({
          title: draft.title.trim(),
          description: draft.description.trim() || undefined,
          potType: draft.potType,
          refundType: draft.refundType,
          minContribution: isPositiveAmount(draft.minContribution)
            ? (toNairaAmount(draft.minContribution) ?? undefined)
            : undefined,
          maxContribution: isPositiveAmount(draft.maxContribution)
            ? (toNairaAmount(draft.maxContribution) ?? undefined)
            : undefined,
          goalAmount: isPositiveAmount(draft.goalAmount)
            ? (toNairaAmount(draft.goalAmount) ?? undefined)
            : undefined,
          payoutMode: draft.payoutMode ?? "manual",
          payoutConfig: buildPayoutConfig(draft),
        });
        clearDraftPot();
        router.push(`/pots/${pot.id}/edit`);
        return;
      }

      router.push("/dashboard");
    }, 500);
  }

  function handleResend() {
    if (secondsLeft > 0) return;
    reset();
    showToast(`We sent a new code to ${email}. Check spam if you don't see it.`, "success");
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      <div className="flex flex-col gap-1.5">
        <OtpInput
          value={code}
          onChange={(next) => {
            setCode(next);
            setShowError(false);
          }}
        />
        {showError && !isComplete && (
          <Text size="xs" color="error">
            Enter all 6 digits.
          </Text>
        )}
      </div>
      <Button type="submit" size="lg" className="w-full" disabled={!isComplete || isSubmitting}>
        {isSubmitting ? <Spinner size="sm" className="text-white" /> : "Verify"}
      </Button>
      <div className="text-center">
        {secondsLeft > 0 ? (
          <Text size="sm" color="secondary">
            Resend in {label}
          </Text>
        ) : (
          <button
            type="button"
            onClick={handleResend}
            className="text-sm font-medium text-accent"
          >
            Resend code
          </button>
        )}
      </div>
    </form>
  );
}
