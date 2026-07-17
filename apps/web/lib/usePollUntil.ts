"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Shared polling primitive for the backend's async money flows — contribution funding
// (POST /pots/:id/contributions returns a pending virtual account, only resolved once Nomba's
// webhook confirms funding) and payout/refund triggers (202, fire-and-forget, resolved once the
// queued disbursement completes) — see docs/system-rules.md. `check` runs every `intervalMs`
// until it returns a non-null result (the resolved value) or `start` is called again; callers
// read `status`/`result` to render a "processing" state in the meantime.
// A single transient failure (a dropped connection, a momentary 5xx) shouldn't kill an otherwise
// multi-minute poll — this many CONSECUTIVE failures in a row is what actually surfaces the
// "error" status to the caller; anything below that retries silently on the same interval, same as
// a null (not-yet-resolved) result would.
const MAX_CONSECUTIVE_FAILURES = 5;

export function usePollUntil<T>(check: () => Promise<T | null>, intervalMs = 4000) {
  const [status, setStatus] = useState<"idle" | "polling" | "done" | "error">("idle");
  const [result, setResult] = useState<T | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const checkRef = useRef(check);
  const consecutiveFailuresRef = useRef(0);
  useEffect(() => {
    checkRef.current = check;
  }, [check]);

  const stop = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = null;
  }, []);

  const tick = useCallback(async () => {
    try {
      const value = await checkRef.current();
      consecutiveFailuresRef.current = 0;
      if (value !== null) {
        setResult(value);
        setStatus("done");
        return;
      }
      timeoutRef.current = setTimeout(tick, intervalMs);
    } catch {
      consecutiveFailuresRef.current += 1;
      if (consecutiveFailuresRef.current >= MAX_CONSECUTIVE_FAILURES) {
        setStatus("error");
        return;
      }
      // Still under the threshold — retry on the same schedule rather than giving up on the first
      // blip; the caller only sees "error" once this stops looking transient.
      timeoutRef.current = setTimeout(tick, intervalMs);
    }
  }, [intervalMs]);

  const start = useCallback(() => {
    stop();
    consecutiveFailuresRef.current = 0;
    setStatus("polling");
    setResult(null);
    tick();
  }, [stop, tick]);

  // Runs one check immediately, independent of the interval timer — for a
  // user-triggered "check now" action (see AwaitingPaymentModal's "I've
  // paid" button) rather than waiting for the next scheduled tick. Callers
  // must still handle a thrown error themselves (this doesn't swallow it) —
  // it only resumes the background poll on failure, same retry/backoff
  // behavior as an ordinary tick, rather than leaving polling stopped.
  const checkNow = useCallback(async () => {
    stop();
    try {
      const value = await checkRef.current();
      consecutiveFailuresRef.current = 0;
      if (value !== null) {
        setResult(value);
        setStatus("done");
      } else {
        timeoutRef.current = setTimeout(tick, intervalMs);
      }
      return value;
    } catch (err) {
      timeoutRef.current = setTimeout(tick, intervalMs);
      throw err;
    }
  }, [stop, tick, intervalMs]);

  useEffect(() => stop, [stop]);

  return { status, result, start, stop, checkNow };
}
