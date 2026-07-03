"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { AppHeader } from "@/components/layout/AppHeader";
import { Button } from "@/components/ui/Button";
import { Container } from "@/components/ui/Container";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Text } from "@/components/ui/Text";
import { nigerianBanks } from "@/lib/mock/fixtures";
import { useMockStore } from "@/lib/mock/store";
import { useToast } from "@/lib/toast";

const NUBAN_LENGTH = 10;

export default function RefundAccountPage() {
  const { currentUser, setRefundProfile } = useMockStore();
  const { showToast } = useToast();
  const router = useRouter();

  const [bankCode, setBankCode] = useState(currentUser?.defaultRefundBank ?? "");
  const [accountNumber, setAccountNumber] = useState(currentUser?.defaultRefundAccount ?? "");

  const isComplete = bankCode !== "" && accountNumber.length === NUBAN_LENGTH;
  const confirmedName = isComplete ? currentUser?.fullName.toUpperCase() : null;

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!isComplete) return;
    setRefundProfile(accountNumber, bankCode);
    showToast("Refund account saved", "success");
    router.push("/profile");
  }

  return (
    <>
      <AppHeader title="Refund account" backHref="/profile" />
      <Container className="py-6">
        <Text color="secondary" className="mb-6">
          This is where refunds go if you trigger one as a pot admin.
        </Text>

        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          <Field label="Bank" htmlFor="refund-bank" required>
            <Select
              id="refund-bank"
              value={bankCode}
              onChange={(event) => setBankCode(event.target.value)}
              required
            >
              <option value="" disabled>
                Select a bank
              </option>
              {nigerianBanks.map((bank) => (
                <option key={bank.code} value={bank.code}>
                  {bank.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Account number" htmlFor="refund-account-number" required>
            <Input
              id="refund-account-number"
              type="tel"
              inputMode="numeric"
              maxLength={NUBAN_LENGTH}
              value={accountNumber}
              onChange={(event) => setAccountNumber(event.target.value.replace(/\D/g, ""))}
              placeholder="0123456789"
              required
            />
          </Field>

          {confirmedName && (
            <Field label="Account name">
              <Text weight="medium">{confirmedName}</Text>
            </Field>
          )}

          <Button type="submit" disabled={!isComplete} className="mt-2">
            Save refund account
          </Button>
        </form>
      </Container>
    </>
  );
}
