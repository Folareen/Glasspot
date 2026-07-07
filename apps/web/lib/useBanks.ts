"use client";

import { useEffect, useState } from "react";
import { listBanks } from "./api";
import type { Bank } from "./types";

// Replaces lib/mock/fixtures.ts's hardcoded nigerianBanks list with the real GET /banks call
// (backend-cached bank code list) — every bank <Select> in the app reads from here now.
export function useBanks() {
  const [banks, setBanks] = useState<Bank[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    listBanks()
      .then((data) => {
        if (!cancelled) setBanks(data.banks);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { banks, isLoading };
}
