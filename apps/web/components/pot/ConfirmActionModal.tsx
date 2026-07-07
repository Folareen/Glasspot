"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Text } from "@/components/ui/Text";
import { Spinner } from "@/components/ui/Spinner";

type ConfirmActionModalProps = {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description: string;
  confirmLabel: string;
  danger?: boolean;
};

export function ConfirmActionModal({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel,
  danger = false,
}: ConfirmActionModalProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);

  function handleConfirm() {
    setIsSubmitting(true);
    onConfirm();
    setIsSubmitting(false);
    onClose();
  }

  return (
    <Modal open={open} onClose={onClose} title={title}>
      <div className="flex flex-col gap-5">
        <Text color="secondary">{description}</Text>
        <div className="flex gap-3">
          <Button variant="secondary" className="flex-1" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant={danger ? "danger" : "primary"}
            className="flex-1"
            onClick={handleConfirm}
            disabled={isSubmitting}
          >
            {isSubmitting && <Spinner size="sm" />}
            {confirmLabel}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
