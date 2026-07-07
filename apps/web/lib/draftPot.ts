import type { WizardState } from "@/components/pot/wizard/wizard-types";

// Holds a pot template a visitor picked on the landing page before they had
// an account, so signup/login can pick it back up and create the pot for
// them immediately afterward instead of losing their choice. Cleared as
// soon as it's been turned into a real pot.
const DRAFT_POT_KEY = "glasspot:draft-pot";

export function saveDraftPot(state: WizardState): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(DRAFT_POT_KEY, JSON.stringify(state));
}

export function getDraftPot(): WizardState | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(DRAFT_POT_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as WizardState;
  } catch {
    return null;
  }
}

export function clearDraftPot(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(DRAFT_POT_KEY);
}
