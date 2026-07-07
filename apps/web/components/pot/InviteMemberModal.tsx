"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { ApiError, addMember } from "@/lib/api";
import { useToast } from "@/lib/toast";
import type { PotMemberRole } from "@/lib/types";

type InviteMemberModalProps = {
  open: boolean;
  onClose: () => void;
  potId: string;
  onAdded: () => void;
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function InviteMemberModal({ open, onClose, potId, onAdded }: InviteMemberModalProps) {
  const { showToast } = useToast();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<PotMemberRole>("member");
  const [emailError, setEmailError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit() {
    const trimmedEmail = email.trim();
    if (!EMAIL_PATTERN.test(trimmedEmail)) {
      setEmailError("Enter a valid email address.");
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await addMember(potId, { email: trimmedEmail, role });
      const isPending = "status" in result && result.status === "pending";
      showToast(
        isPending
          ? `Invite sent to ${trimmedEmail} — they'll join once they sign up`
          : `${trimmedEmail} added to the pot`,
        "success"
      );
      setEmail("");
      setRole("member");
      setEmailError("");
      onAdded();
      onClose();
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : "Couldn't add that member", "error");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Add a member">
      <div className="flex flex-col gap-4">
        <Field label="Email address" htmlFor="invite-email" required error={emailError || undefined}>
          <Input
            id="invite-email"
            type="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setEmailError("");
            }}
            placeholder="amaka@example.com"
            error={Boolean(emailError)}
          />
        </Field>
        <Field label="Role" htmlFor="invite-role">
          <Select id="invite-role" value={role} onChange={(e) => setRole(e.target.value as PotMemberRole)}>
            <option value="member">Member</option>
            <option value="admin">Admin</option>
          </Select>
        </Field>
        <Button className="w-full" onClick={handleSubmit} disabled={!EMAIL_PATTERN.test(email.trim()) || isSubmitting}>
          {isSubmitting && <Spinner size="sm" />}
          Add member
        </Button>
      </div>
    </Modal>
  );
}
