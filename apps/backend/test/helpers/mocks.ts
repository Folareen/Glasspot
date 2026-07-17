import type { TestContext } from "node:test";
import { nomba } from "../../src/integrations/nomba";

// NOTE: there is no mockOtpGeneration helper here. An earlier version
// tried t.mock.method / t.mock.module on @/lib/otp's generateOtpCode, but
// action-otp.service.ts's static import of that function is linked the
// first time the module is evaluated — which happens inside
// createTestApp()'s eager route-tree import in `before()`, before any
// per-test mock is installed. Neither t.mock.method (fails outright on a
// real ESM namespace object — its bindings are non-configurable by spec)
// nor t.mock.module (only affects specifiers resolved AFTER the mock
// call) can retroactively rewire that binding. Use
// helpers/factories.ts's forceActionOtpCode instead: let the real
// POST .../otp endpoint run, then overwrite the resulting DB row's hash
// using the app's own real hashOtpCode/hashActionContext functions. No
// mocking, no ESM linking problem.

/**
 * Mocks the real `nomba` singleton's network-hitting methods in place.
 * Works regardless of which module imports `nomba` — every importer gets
 * the same instance (Node's module cache), and t.mock.method patches the
 * method on that shared instance, restored automatically when `t` (or its
 * parent test) finishes. Returns the mock handles so a test can override
 * a specific call's behavior or assert on call args/count.
 *
 * Defaults are deliberately generic/successful — override per-test via
 * `mocks.lookupBankAccount.mock.mockImplementationOnce(...)` etc. for
 * failure-path tests.
 */
export function mockNomba(t: TestContext) {
  const lookupBankAccount = t.mock.method(nomba, "lookupBankAccount", async () => ({
    accountName: "Test Account Holder",
    accountNumber: "1000000001",
    bankCode: "000013",
  }));

  const createVirtualAccount = t.mock.method(nomba, "createVirtualAccount", async () => ({
    accountRef: "mock-account-ref",
    bankAccountNumber: "9000000001",
    bankName: "Mock Bank",
    accountName: "Mock Virtual Account",
  }));

  const refundOverpayment = t.mock.method(nomba, "refundOverpayment", async () => ({
    status: "SUCCESS",
    merchantTxRef: "mock-refund-ref",
  }));

  const transferToBankAccount = t.mock.method(nomba, "transferToBankAccount", async () => ({
    status: "SUCCESS",
    merchantTxRef: "mock-transfer-ref",
  }));

  const expireVirtualAccount = t.mock.method(nomba, "expireVirtualAccount", async () => ({
    expired: true,
  }));

  return { lookupBankAccount, createVirtualAccount, refundOverpayment, transferToBankAccount, expireVirtualAccount };
}