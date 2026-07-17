"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import { OtpInput } from "@/components/auth/OtpInput";
import { useResendTimer } from "@/components/auth/useResendTimer";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Heading } from "@/components/ui/Heading";
import { Spinner } from "@/components/ui/Spinner";
import { Text } from "@/components/ui/Text";
import { AuthProvider, useAuth } from "@/lib/auth";
import { useToast } from "@/lib/toast";
import { ApiError, createPot, resendOtp, verifyEmail, verifyLoginOtp } from "@/lib/api";
import { getDraftPot, clearDraftPot } from "@/lib/draftPot";
import { clearPendingVerifyEmail, getPendingVerifyEmail } from "@/lib/pendingVerifyEmail";
import { buildPayoutConfig, isPositiveAmount } from "@/components/pot/wizard/wizard-helpers";
import { toNairaAmount } from "@/lib/money";

type OtpVerifyFormProps = {
  mode: "login" | "signup";
  successMessage: string;
  /** Where to send the user after a successful login — set when they were bounced here from a
   * protected page (proxy.ts's redirect, or apiFetch's redirectToLogin on a dead session).
   * Login-only: a pending draft pot (either mode) always takes priority over this regardless. */
  redirectTo?: string;
};

// This page isn't wrapped in AuthProvider by default (see app/layout.tsx — AuthProvider is scoped
// away from the public login/signup entry pages so they don't fire GET /me on load), but
// verifying an OTP code both needs useAuth's refresh() afterward and is itself the moment a
// session starts to exist — so this component brings its own AuthProvider rather than requiring
// every call site to remember to wrap it.
export function OtpVerifyForm(props: OtpVerifyFormProps) {
  return (
    <AuthProvider>
      <OtpVerifyFormInner {...props} />
    </AuthProvider>
  );
}

function OtpVerifyFormInner({ mode, successMessage, redirectTo }: OtpVerifyFormProps) {
  const router = useRouter();
  const { refresh } = useAuth();
  const { showToast } = useToast();
  const { secondsLeft, label, reset } = useResendTimer();
  const [code, setCode] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  // Read from sessionStorage rather than a URL param so the email never appears in the
  // address bar, browser history, or server access logs. Missing entirely (e.g. the user
  // landed here directly, or opened the link in a different tab) means there's nothing to
  // verify — bounce back to start the flow properly rather than rendering a broken form.
  const [email] = useState(() => getPendingVerifyEmail());

  useEffect(() => {
    if (!email) {
      router.replace(mode === "login" ? "/login" : "/signup");
    }
  }, [email, mode, router]);
  // Read once on mount, not re-checked per render — this is purely to decide whether to show the
  // "we'll create it for you" banner below; the real read-and-create happens in handleSubmit.
  // Checked for both modes: TryItModal always sends a brand-new visitor to /signup, but a
  // returning visitor can click through to /login from there instead, with the draft still
  // sitting in localStorage — handleSubmit's draft pickup already runs regardless of mode, so
  // the banner should match rather than only ever appearing on the signup path.
  const [draftTitle] = useState(() => getDraftPot()?.title.trim());

  const isComplete = code.length === 6;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email) return;
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
      clearPendingVerifyEmail();
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
        } catch (e) {
          clearDraftPot();
          showToast(
            e instanceof ApiError ? e.message : "Your account's ready, but we couldn't create your pot. Try again from Home.",
            "error"
          );
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
    if (secondsLeft > 0 || !email) return;
    try {
      await resendOtp({ email, purpose: mode === "login" ? "login" : "signup_verification" });
      reset();
      showToast(`We sent a new code to ${email}. Check spam if you don't see it.`, "success");
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : "Couldn't resend the code", "error");
    }
  }

  if (!email) {
    return (
      <div className="flex justify-center py-8">
        <Spinner size="md" />
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      <div className="mb-2 text-center">
        <Heading level={3}>{mode === "login" ? "Enter your code" : "Verify your email"}</Heading>
        <Text color="secondary" className="mt-1">
          Enter the code we sent to {email}
          {mode === "signup" ? " to finish setting up your account." : "."}
        </Text>
        <Text size="sm" color="secondary" className="mt-2">
          Can&apos;t find it? Check your spam or junk folder.
        </Text>
      </div>
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
