"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import { OtpInput } from "@/components/auth/OtpInput";
import { useResendTimer } from "@/components/auth/useResendTimer";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
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
  /** Where to send the user after a successful login — set when they were bounced here from a
   * protected page (proxy.ts's redirect, or apiFetch's redirectToLogin on a dead session).
   * Login-only: signup has its own draft-pot redirect below, which takes priority regardless. */
  redirectTo?: string;
};

export function OtpVerifyForm({ email, mode, successMessage, redirectTo }: OtpVerifyFormProps) {
  const router = useRouter();
  const { refresh } = useAuth();
  const { showToast } = useToast();
  const { secondsLeft, label, reset } = useResendTimer();
  const [code, setCode] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  // Read once on mount, not re-checked per render — this is purely to decide whether to show the
  // "we'll create it for you" banner below; the real read-and-create happens in handleSubmit.
  const [draftTitle] = useState(() => (mode === "signup" ? getDraftPot()?.title.trim() : undefined));

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

      // Only ever a same-app relative path, and never back to /login itself — redirectTo comes
      // from a URL query param, so an absolute/external value (e.g. "https://evil.com" or
      // "//evil.com") is rejected rather than handed to router.push (which would otherwise let a
      // crafted link send a logged-in user off-site), and a value starting with "/login" is
      // rejected too so a stale/malformed link can never bounce the user straight back to login.
      const isSafeRedirect =
        mode === "login" &&
        redirectTo?.startsWith("/") &&
        !redirectTo.startsWith("//") &&
        !redirectTo.startsWith("/login");
      router.push(isSafeRedirect ? redirectTo! : "/home");
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
      {draftTitle && (
        <Card tone="accent" padding="sm" className="flex items-start gap-2.5">
          <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-accent" strokeWidth={1.5} />
          <Text size="sm" color="secondary">
            Verify to create <span className="font-medium text-text-primary">{draftTitle}</span> —
            we&apos;ll take you straight to it.
          </Text>
        </Card>
      )}
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
