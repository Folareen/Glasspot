import { nomba } from "@/integrations/nomba";
import { NombaApiError } from "@/integrations/nomba/nomba.error";

export class AccountVerificationError extends Error {
  statusCode = 400;
  constructor(message = "Could not verify account details with the bank") {
    super(message);
    this.name = "AccountVerificationError";
  }
}

/**
 * Resolves accountNumber/bankCode against Nomba before it's persisted as a
 * payout/refund destination or used for a transfer — the single place every
 * write path in this codebase should call instead of hitting
 * nomba.lookupBankAccount() inline (see docs/system-rules.md: never trust a
 * client-supplied destination without confirming it resolves to a real
 * account). Wraps any NombaApiError (account not found, bad bank code, etc)
 * into a 400 rather than letting a raw provider error escape.
 */
export async function verifyAccountDetails(accountNumber: string, bankCode: string): Promise<{ accountName: string }> {
  try {
    const resolved = await nomba.lookupBankAccount(accountNumber, bankCode);
    return { accountName: resolved.accountName };
  } catch (err) {
    if (err instanceof NombaApiError) {
      throw new AccountVerificationError(err.message);
    }
    throw err;
  }
}
