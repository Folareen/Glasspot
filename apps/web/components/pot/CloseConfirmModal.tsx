"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Text } from "@/components/ui/Text";
import { Spinner } from "@/components/ui/Spinner";

type CloseConfirmModalProps = {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  /** Pot's current balance, wire-format naira string. */
  balance: string;
};

export function CloseConfirmModal({ open, onClose, onConfirm, balance }: CloseConfirmModalProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleClose() {
    setError(null);
    onClose();
  }

  function handleConfirm() {
    if (Number(balance) !== 0) {
      setError("This pot still has a balance. Pay out or refund it down to zero before closing.");
      return;
    }
    setIsSubmitting(true);
    onConfirm();
    setIsSubmitting(false);
    handleClose();
  }

  return (
    <Modal open={open} onClose={handleClose} title="Close this pot?">
      <div className="flex flex-col gap-5">
        <Text color="secondary">
          Closing a pot is final. You can only close a pot once its balance is zero.
        </Text>
        {error && (
          <Text size="sm" color="error">
            {error}
          </Text>
        )}
        <div className="flex gap-3">
          <Button variant="secondary" className="flex-1" onClick={handleClose}>
            Cancel
          </Button>
          <Button variant="danger" className="flex-1" onClick={handleConfirm} disabled={isSubmitting}>
            {isSubmitting && <Spinner size="sm" />}
            Close pot
          </Button>
        </div>
      </div>
    </Modal>
  );
}
