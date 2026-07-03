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

export function InviteMemberModal({ open, onClose, potId }: InviteMemberModalProps) {
  const { addMember } = useMockStore();
  const { showToast } = useToast();
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState<PotMemberRole>("member");

  function handleSubmit() {
    const name = fullName.trim();
    if (!name) return;
    addMember(potId, name, role);
    showToast(`${name} added to the pot`, "success");
    setFullName("");
    setRole("member");
    onClose();
  }

  return (
    <Modal open={open} onClose={onClose} title="Add a member">
      <div className="flex flex-col gap-4">
        <Field label="Full name" htmlFor="invite-name" required>
          <Input
            id="invite-name"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="Amaka Obi"
          />
        </Field>
        <Field label="Role" htmlFor="invite-role">
          <Select id="invite-role" value={role} onChange={(e) => setRole(e.target.value as PotMemberRole)}>
            <option value="member">Member</option>
            <option value="admin">Admin</option>
          </Select>
        </Field>
        <Button className="w-full" onClick={handleSubmit} disabled={!fullName.trim()}>
          Add member
        </Button>
      </div>
    </Modal>
  );
}
