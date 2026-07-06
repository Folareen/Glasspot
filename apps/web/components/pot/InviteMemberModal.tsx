"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { useMockStore } from "@/lib/mock/store";
import { useToast } from "@/lib/toast";
import type { PotMemberRole } from "@/lib/mock/types";

type InviteMemberModalProps = {
  open: boolean;
  onClose: () => void;
  potId: string;
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function InviteMemberModal({ open, onClose, potId }: InviteMemberModalProps) {
  const { addMember } = useMockStore();
  const { showToast } = useToast();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<PotMemberRole>("member");

  function handleSubmit() {
    const trimmedEmail = email.trim();
    if (!EMAIL_PATTERN.test(trimmedEmail)) return;

    const { status } = addMember(potId, trimmedEmail, role);
    showToast(
      status === "active"
        ? `${trimmedEmail} added to the pot`
        : `Invite sent to ${trimmedEmail} — they'll join once they sign up`,
      "success"
    );
    setEmail("");
    setRole("member");
    onClose();
  }

  return (
    <Modal open={open} onClose={onClose} title="Add a member">
      <div className="flex flex-col gap-4">
        <Field label="Email address" htmlFor="invite-email" required>
          <Input
            id="invite-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="amaka@example.com"
          />
        </Field>
        <Field label="Role" htmlFor="invite-role">
          <Select id="invite-role" value={role} onChange={(e) => setRole(e.target.value as PotMemberRole)}>
            <option value="member">Member</option>
            <option value="admin">Admin</option>
          </Select>
        </Field>
        <Button className="w-full" onClick={handleSubmit} disabled={!EMAIL_PATTERN.test(email.trim())}>
          Add member
        </Button>
      </div>
    </Modal>
  );
}
