"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Text } from "@/components/ui/Text";
import { Spinner } from "@/components/ui/Spinner";
import { OtpStep } from "@/components/pot/OtpStep";
import { requestRefundOtp, triggerRefund } from "@/lib/api";

type RefundConfirmModalProps = {
  open: boolean;
  onClose: () => void;
  potId: string;
  onConfirmed: () => void;
  description: string;
};

export function RefundConfirmModal({ open, onClose, potId, onConfirmed, description }: RefundConfirmModalProps) {
  const [step, setStep] = useState<"confirm" | "otp">("confirm");
  const [isSubmitting, setIsSubmitting] = useState(false);

  function handleClose() {
    setStep("confirm");
    onClose();
  }

  async function handleRequestCode() {
    await requestRefundOtp(potId);
  }

  async function handleVerify(otpCode: string) {
    setIsSubmitting(true);
    try {
      await triggerRefund(potId, { otpCode });
      onConfirmed();
      handleClose();
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Modal open={open} onClose={handleClose} title="Refund this pot?">
      {step === "confirm" ? (
        <div className="flex flex-col gap-5">
          <Text color="secondary">{description}</Text>
          <div className="flex gap-3">
            <Button variant="secondary" className="flex-1" onClick={handleClose}>
              Cancel
            </Button>
            <Button variant="danger" className="flex-1" onClick={() => setStep("otp")} disabled={isSubmitting}>
              {isSubmitting && <Spinner size="sm" />}
              Continue
            </Button>
          </div>
        </div>
      ) : (
        <OtpStep
          description="Enter the code we sent to your email to confirm this refund."
          confirmLabel="Trigger refund"
          onBack={() => setStep("confirm")}
          onRequestCode={handleRequestCode}
          onVerify={handleVerify}
          danger
        />
      )}
    </Modal>
  );
}
