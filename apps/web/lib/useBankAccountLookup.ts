"use client";

import { useEffect, useState } from "react";
import { ApiError, lookupBankAccount } from "./api";

const NUBAN_LENGTH = 10;

/**
 * Resolves and confirms the account-holder name for an account number + bank code pair as soon
 * as both are complete, debounced by React's own effect-cleanup (a fresh accountNumber/bankCode
 * cancels the in-flight lookup for the old pair). Mirrors the pattern first built for
 * profile/refund-account/page.tsx — extracted here so every other account+bank entry point
 * (payout destinations, wizard steps) gets the same "show the resolved name before the user
 * submits" confirmation instead of trusting a raw account number.
 *
 * confirmedName is tagged to the exact pair it resolved for, so it never shows a stale name once
 * the user has changed either field again but the new lookup hasn't landed yet.
 */
export function useBankAccountLookup(accountNumber: string, bankCode: string) {
  const [confirmed, setConfirmed] = useState<{ accountNumber: string; bankCode: string; name: string } | null>(
    null
  );
  const [isLookingUp, setIsLookingUp] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isComplete = bankCode !== "" && accountNumber.length === NUBAN_LENGTH;
  const confirmedName =
    confirmed && confirmed.accountNumber === accountNumber && confirmed.bankCode === bankCode
      ? confirmed.name
      : null;

  useEffect(() => {
    if (!isComplete) {
      setError(null);
      return;
    }
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- immediate loading indicator for the lookup this same effect kicks off; there's no external event to defer it to.
    setIsLookingUp(true);
    setError(null);
    lookupBankAccount({ accountNumber, bankCode })
      .then((result) => {
        if (!cancelled) setConfirmed({ accountNumber, bankCode, name: result.accountName });
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof ApiError ? e.message : "Couldn't verify that account.");
      })
      .finally(() => {
        if (!cancelled) setIsLookingUp(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- isComplete is derived from accountNumber/bankCode, not an independent dependency.
  }, [accountNumber, bankCode]);

  return { confirmedName, isLookingUp, error, isComplete };
}
