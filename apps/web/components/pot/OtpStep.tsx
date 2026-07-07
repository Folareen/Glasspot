"use client";

import { useEffect, useState } from "react";
import { OtpInput } from "@/components/auth/OtpInput";
import { useResendTimer } from "@/components/auth/useResendTimer";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { Text } from "@/components/ui/Text";
import { useToast } from "@/lib/toast";
import { ApiError } from "@/lib/api";

type OtpStepProps = {
  description: string;
  confirmLabel: string;
  onBack: () => void;
  /** Requests the confirmation code — called once when this step mounts, and again on "Resend code". Bound to the exact destination/amount being confirmed (see requestPayoutOtp/requestRefundOtp), so this must fire before the user can enter anything. */
  onRequestCode: () => Promise<void>;
  /** Verifies the code against the backend — must throw (ApiError) on an invalid/expired code so this step can show the error and let the user retry, rather than assuming success. */
  onVerify: (code: string) => Promise<void>;
  danger?: boolean;
};

export function OtpStep({ description, confirmLabel, onBack, onRequestCode, onVerify, danger = false }: OtpStepProps) {
  const { showToast } = useToast();
  const { secondsLeft, label, reset } = useResendTimer();
  const [code, setCode] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    onRequestCode().catch((e) => {
      showToast(e instanceof ApiError ? e.message : "Couldn't send a confirmation code", "error");
    });
    // Only re-runs explicitly via handleResend — a dependency on onRequestCode would re-request
    // every render since callers pass a fresh closure each time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isComplete = code.length === 6;

  async function handleConfirm() {
    if (!isComplete) return;
    setIsSubmitting(true);
    setError("");
    try {
      await onVerify(code);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't verify that code");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleResend() {
    if (secondsLeft > 0) return;
    try {
      await onRequestCode();
      reset();
      showToast("We sent a new code to your email. Check spam if you don't see it.", "success");
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : "Couldn't resend the code", "error");
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <Text color="secondary">{description}</Text>
      <OtpInput value={code} onChange={setCode} />
      {error && (
        <Text size="sm" color="error" className="text-center">
          {error}
        </Text>
      )}
      <div className="text-center">
        {secondsLeft > 0 ? (
          <Text size="sm" color="secondary">
            Resend in {label}
          </Text>
        ) : (
          <button type="button" onClick={handleResend} className="text-sm font-medium text-accent">
            Resend code
          </button>
        )}
      </div>
      <div className="flex gap-3">
        <Button variant="secondary" className="flex-1" onClick={onBack}>
          Back
        </Button>
        <Button
          variant={danger ? "danger" : "primary"}
          className="flex-1"
          onClick={handleConfirm}
          disabled={!isComplete || isSubmitting}
        >
          {isSubmitting && <Spinner size="sm" />}
          {confirmLabel}
        </Button>
      </div>
    </div>
  );
}
