"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Shared polling primitive for the backend's async money flows — contribution funding
// (POST /pots/:id/contributions returns a pending virtual account, only resolved once Nomba's
// webhook confirms funding) and payout/refund triggers (202, fire-and-forget, resolved once the
// queued disbursement completes) — see docs/system-rules.md. `check` runs every `intervalMs`
// until it returns a non-null result (the resolved value) or `start` is called again; callers
// read `status`/`result` to render a "processing" state in the meantime.
export function usePollUntil<T>(check: () => Promise<T | null>, intervalMs = 4000) {
  const [status, setStatus] = useState<"idle" | "polling" | "done" | "error">("idle");
  const [result, setResult] = useState<T | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const checkRef = useRef(check);
  useEffect(() => {
    checkRef.current = check;
  }, [check]);

  const stop = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = null;
  }, []);

  const start = useCallback(() => {
    stop();
    setStatus("polling");
    setResult(null);

    const tick = async () => {
      try {
        const value = await checkRef.current();
        if (value !== null) {
          setResult(value);
          setStatus("done");
          return;
        }
        timeoutRef.current = setTimeout(tick, intervalMs);
      } catch {
        setStatus("error");
      }
    };

    tick();
  }, [intervalMs, stop]);

  useEffect(() => stop, [stop]);

  return { status, result, start, stop };
}
