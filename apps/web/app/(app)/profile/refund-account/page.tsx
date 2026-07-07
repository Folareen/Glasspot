"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AppHeader } from "@/components/layout/AppHeader";
import { PageHeading } from "@/components/layout/PageHeading";
import { Button } from "@/components/ui/Button";
import { Container } from "@/components/ui/Container";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Text } from "@/components/ui/Text";
import { Spinner } from "@/components/ui/Spinner";
import { useBanks } from "@/lib/useBanks";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/lib/toast";
import { ApiError, lookupBankAccount, updateRefundProfile } from "@/lib/api";

const NUBAN_LENGTH = 10;

export default function RefundAccountPage() {
  const { currentUser, setCurrentUser } = useAuth();
  const { banks } = useBanks();
  const { showToast } = useToast();
  const router = useRouter();

  const [bankCode, setBankCode] = useState(currentUser?.defaultRefundBank ?? "");
  const [accountNumber, setAccountNumber] = useState(currentUser?.defaultRefundAccount ?? "");
  const [errors, setErrors] = useState<{ bankCode?: string; accountNumber?: string }>({});
  // Tagged with the exact accountNumber/bankCode pair it was resolved for, so a lookup that
  // resolves after the user has already changed either field is never shown as confirming the
  // new (different) pair — avoids a synchronous "reset to null" at the top of the lookup effect.
  const [confirmed, setConfirmed] = useState<{ accountNumber: string; bankCode: string; name: string } | null>(null);
  const [isLookingUp, setIsLookingUp] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isComplete = bankCode !== "" && accountNumber.length === NUBAN_LENGTH;
  const confirmedName =
    confirmed && confirmed.accountNumber === accountNumber && confirmed.bankCode === bankCode
      ? confirmed.name
      : null;

  useEffect(() => {
    if (!isComplete) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- immediate loading indicator for the lookup this same effect kicks off; there's no external event to defer it to.
    setIsLookingUp(true);
    lookupBankAccount({ accountNumber, bankCode })
      .then((result) => {
        if (!cancelled) setConfirmed({ accountNumber, bankCode, name: result.accountName });
      })
      .catch((e) => {
        if (!cancelled) {
          setErrors((prev) => ({
            ...prev,
            accountNumber: e instanceof ApiError ? e.message : "Couldn't verify that account.",
          }));
        }
      })
      .finally(() => {
        if (!cancelled) setIsLookingUp(false);
      });
    return () => {
      cancelled = true;
    };
  }, [accountNumber, bankCode, isComplete]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const nextErrors: { bankCode?: string; accountNumber?: string } = {};
    if (!bankCode) {
      nextErrors.bankCode = "Choose your bank.";
    }
    if (accountNumber.length !== NUBAN_LENGTH) {
      nextErrors.accountNumber = "Enter your 10-digit account number.";
    }
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }
    setErrors({});
    setIsSubmitting(true);
    try {
      const result = await updateRefundProfile({ accountNumber, bankCode });
      if (currentUser) {
        setCurrentUser({
          ...currentUser,
          defaultRefundAccount: result.defaultRefundAccount,
          defaultRefundBank: result.defaultRefundBank,
        });
      }
      showToast("Refund account saved", "success");
      router.push("/profile");
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : "Couldn't save your refund account", "error");
      setIsSubmitting(false);
    }
  }

  return (
    <>
      <AppHeader title="Refund account" backHref="/profile" />
      <Container className="py-6 lg:py-10">
        <PageHeading title="Refund account" backHref="/profile" className="mb-6 hidden lg:block" />
        <Text color="secondary" className="mb-6">
          This is where refunds go if you trigger one as a pot admin.
        </Text>

        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          <Field label="Bank" htmlFor="refund-bank" required error={errors.bankCode}>
            <Select
              id="refund-bank"
              value={bankCode}
              onChange={(event) => {
                setBankCode(event.target.value);
                setErrors((prev) => ({ ...prev, bankCode: undefined }));
              }}
              required
              error={Boolean(errors.bankCode)}
            >
              <option value="" disabled>
                Select a bank
              </option>
              {banks.map((bank) => (
                <option key={bank.code} value={bank.code}>
                  {bank.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Account number" htmlFor="refund-account-number" required error={errors.accountNumber}>
            <Input
              id="refund-account-number"
              type="tel"
              inputMode="numeric"
              maxLength={NUBAN_LENGTH}
              value={accountNumber}
              onChange={(event) => {
                setAccountNumber(event.target.value.replace(/\D/g, ""));
                setErrors((prev) => ({ ...prev, accountNumber: undefined }));
              }}
              placeholder="0123456789"
              required
              error={Boolean(errors.accountNumber)}
            />
          </Field>

          {isLookingUp && (
            <div className="flex items-center gap-2">
              <Spinner size="sm" />
              <Text size="sm" color="secondary">
                Verifying account...
              </Text>
            </div>
          )}

          {confirmedName && !isLookingUp && (
            <Field label="Account name">
              <Text weight="medium">{confirmedName}</Text>
            </Field>
          )}

          <Button type="submit" disabled={!isComplete || !confirmedName || isSubmitting} className="mt-2">
            {isSubmitting && <Spinner size="sm" />}
            Save refund account
          </Button>
        </form>
      </Container>
    </>
  );
}
