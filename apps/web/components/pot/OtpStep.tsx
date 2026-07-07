"use client";

import { useState } from "react";
import { OtpInput } from "@/components/auth/OtpInput";
import { useResendTimer } from "@/components/auth/useResendTimer";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { Text } from "@/components/ui/Text";
import { useToast } from "@/lib/toast";

type OtpStepProps = {
  description: string;
  confirmLabel: string;
  onBack: () => void;
  onVerified: () => void;
  danger?: boolean;
};

export function OtpStep({ description, confirmLabel, onBack, onVerified, danger = false }: OtpStepProps) {
  const { showToast } = useToast();
  const { secondsLeft, label, reset } = useResendTimer();
  const [code, setCode] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isComplete = code.length === 6;

  function handleConfirm() {
    if (!isComplete) return;
    setIsSubmitting(true);
    onVerified();
    setIsSubmitting(false);
  }

  function handleResend() {
    if (secondsLeft > 0) return;
    reset();
    showToast("We sent a new code to your email. Check spam if you don't see it.", "success");
  }

  return (
    <div className="flex flex-col gap-5">
      <Text color="secondary">{description}</Text>
      <OtpInput value={code} onChange={setCode} />
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
