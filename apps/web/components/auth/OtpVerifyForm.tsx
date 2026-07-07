"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { OtpInput } from "@/components/auth/OtpInput";
import { useResendTimer } from "@/components/auth/useResendTimer";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { Text } from "@/components/ui/Text";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/lib/toast";
import { ApiError, createPot, resendOtp, verifyEmail, verifyLoginOtp } from "@/lib/api";
import { getDraftPot, clearDraftPot } from "@/lib/draftPot";
import { buildPayoutConfig, isPositiveAmount } from "@/components/pot/wizard/wizard-helpers";
import { toNairaAmount } from "@/lib/money";

type OtpVerifyFormProps = {
  email: string;
  mode: "login" | "signup";
  successMessage: string;
};

export function OtpVerifyForm({ email, mode, successMessage }: OtpVerifyFormProps) {
  const router = useRouter();
  const { refresh } = useAuth();
  const { showToast } = useToast();
  const { secondsLeft, label, reset } = useResendTimer();
  const [code, setCode] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  const isComplete = code.length === 6;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isComplete) {
      setError("Enter all 6 digits.");
      return;
    }
    setError("");
    setIsSubmitting(true);
    try {
      if (mode === "login") {
        await verifyLoginOtp({ email, code });
      } else {
        await verifyEmail({ email, code });
      }
      await refresh();
      showToast(successMessage, "success");

      const draft = getDraftPot();
      if (draft && draft.title.trim() && draft.payoutMode) {
        try {
          const pot = await createPot({
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
            payoutMode: draft.payoutMode,
            payoutConfig: buildPayoutConfig(draft),
          });
          clearDraftPot();
          router.push(`/pots/${pot.id}/edit`);
          return;
        } catch {
          clearDraftPot();
        }
      }

      router.push("/home");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't verify that code");
      setIsSubmitting(false);
    }
  }

  async function handleResend() {
    if (secondsLeft > 0) return;
    try {
      await resendOtp({ email, purpose: mode === "login" ? "login" : "signup_verification" });
      reset();
      showToast(`We sent a new code to ${email}. Check spam if you don't see it.`, "success");
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : "Couldn't resend the code", "error");
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      <div className="flex flex-col gap-1.5">
        <OtpInput
          value={code}
          onChange={(next) => {
            setCode(next);
            setError("");
          }}
        />
        {error && (
          <Text size="xs" color="error" className="text-center">
            {error}
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
