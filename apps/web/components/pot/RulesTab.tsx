import { Card } from "@/components/ui/Card";
import { Text } from "@/components/ui/Text";
import { Divider } from "@/components/ui/Divider";
import { useBanks } from "@/lib/useBanks";
import { formatNaira } from "@/lib/money";
import type { Bank, PotResponse } from "@/lib/types";

function bankName(banks: Bank[], code: string) {
  return banks.find((bank) => bank.code === code)?.name ?? code;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-NG", { day: "numeric", month: "long", year: "numeric" });
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5">
      <Text size="sm" color="secondary">
        {label}
      </Text>
      <div className="text-right text-sm font-medium text-text-primary">{value}</div>
    </div>
  );
}

function AccountValue({ account, bank, name }: { account: string; bank: string; name?: string }) {
  const { banks } = useBanks();
  return (
    <div className="flex flex-col items-end gap-0.5">
      <span>
        {account} · {bankName(banks, bank)}
      </span>
      {name && (
        <Text size="xs" color="secondary">
          {name}
        </Text>
      )}
    </div>
  );
}

function PayoutRules({ pot }: { pot: PotResponse }) {
  const config = pot.payoutConfig;

  if (pot.payoutMode === "target_based") {
    const targetConfig =
      config && "destinationAccountName" in config && "targetAmount" in config ? config : null;
    return (
      <>
        <Row
          label="Pays out to"
          value={
            targetConfig ? (
              <AccountValue
                account={targetConfig.destinationAccount}
                bank={targetConfig.destinationBank}
                name={targetConfig.destinationAccountName}
              />
            ) : (
              "Not set"
            )
          }
        />
        {targetConfig?.targetDate && (
          <>
            <Divider />
            <Row label="Or when the date arrives" value={formatDate(targetConfig.targetDate)} />
          </>
        )}
        {targetConfig?.targetAmount && (
          <>
            <Divider />
            <Row label="Or when the pot reaches" value={formatNaira(targetConfig.targetAmount)} />
          </>
        )}
        <Divider />
        <Text size="xs" color="secondary" className="pt-2.5">
          Pays out once, automatically, the moment any condition above is met. No admin action
          needed, and the destination can&apos;t be changed after the pot opens.
        </Text>
      </>
    );
  }

  if (pot.payoutMode === "manual") {
    const manualConfig = config && "destinationAccount" in config ? config : null;
    const hasFixedDestination = Boolean(
      manualConfig?.destinationAccount && manualConfig?.destinationBank
    );
    return (
      <>
        <Row
          label="Pays out to"
          value={
            hasFixedDestination && manualConfig ? (
              <AccountValue
                account={manualConfig.destinationAccount ?? ""}
                bank={manualConfig.destinationBank ?? ""}
                name={
                  "destinationAccountName" in manualConfig
                    ? (manualConfig.destinationAccountName ?? undefined)
                    : undefined
                }
              />
            ) : (
              "Chosen by the admin at the moment they trigger it"
            )
          }
        />
        <Divider />
        <Text size="xs" color="secondary" className="pt-2.5">
          {hasFixedDestination
            ? "Any admin can send the balance to this account, at any time, as many times as needed. Each payout requires an email confirmation code first."
            : "Any admin can send the balance to any account, at any time, as many times as needed. The destination is picked at the moment of payout and stays visible on the transaction afterward. Each payout requires an email confirmation code first."}
        </Text>
      </>
    );
  }

  if (pot.payoutMode === "recurring") {
    if (!config || !("amount" in config)) return <Row label="Pays out to" value="Not set" />;
    return (
      <>
        <Row
          label="Pays out to"
          value={
            <AccountValue
              account={config.destinationAccount}
              bank={config.destinationBank}
              name={config.destinationAccountName}
            />
          }
        />
        <Divider />
        <Row label="Amount per payout" value={formatNaira(config.amount)} />
        <Divider />
        <Row label="Repeats every" value={`${config.intervalDays} days`} />
        <Divider />
        <Row label="Next payout" value={formatDate(config.nextRunAt)} />
        <Divider />
        <Text size="xs" color="secondary" className="pt-2.5">
          Repeats automatically on this schedule until the pot closes. No admin action needed.
        </Text>
      </>
    );
  }

  if (pot.payoutMode === "scheduled") {
    if (!config || !("legs" in config)) return <Row label="Pays out to" value="Not set" />;
    return (
      <>
        <Row
          label="Order"
          value={config.ordered ? "In order, one at a time (ajo/esusu style)" : "Independent, each on its own date"}
        />
        {config.legs.map((leg, index) => (
          <div key={index}>
            <Divider />
            <Row
              label={config.ordered ? `Turn ${index + 1}${leg.fired ? " · Paid" : ""}` : `Payout ${index + 1}${leg.fired ? " · Paid" : ""}`}
              value={
                <div className="flex flex-col items-end gap-0.5">
                  <AccountValue
                    account={leg.destinationAccount}
                    bank={leg.destinationBank}
                    name={leg.destinationAccountName}
                  />
                  <Text size="xs" color="secondary">
                    {formatNaira(leg.amount)} on {formatDate(leg.scheduledDate)}
                  </Text>
                </div>
              }
            />
          </div>
        ))}
        <Divider />
        <Text size="xs" color="secondary" className="pt-2.5">
          {config.ordered
            ? "Each turn fires only after the one before it, even if a later turn's date has already passed."
            : "Each payout fires independently on its own date. The same destination can appear more than once."}
        </Text>
      </>
    );
  }

  return null;
}

function RefundRules({ pot }: { pot: PotResponse }) {
  if (pot.refundType === "contributors") {
    return (
      <>
        <Row label="If it doesn't pay out" value="Every contributor gets their own money back" />
        <Divider />
        <Text size="xs" color="secondary" className="pt-2.5">
          Each contributor is refunded to the account they set for their contribution, split by
          exactly what they put in. A contributor who didn&apos;t set a refund account is refunded
          back to the account they originally paid from instead. Triggering a refund requires an
          email confirmation code from the admin who starts it.
        </Text>
      </>
    );
  }

  return (
    <>
      <Row label="If it doesn't pay out" value="The triggering admin gets it back" />
      <Divider />
      <Text size="xs" color="secondary" className="pt-2.5">
        The full balance goes to whichever admin triggers the refund, sent to that admin&apos;s own
        saved refund account — so the exact destination isn&apos;t fixed in advance, but it always
        stays visible on the resulting transaction afterward. Triggering a refund requires an
        email confirmation code first.
      </Text>
    </>
  );
}

export function RulesTab({ pot }: { pot: PotResponse }) {
  return (
    <div className="flex flex-col gap-4">
      {pot.goalAmount && (
        <Card padding="md">
          <Row label="Goal amount" value={formatNaira(pot.goalAmount)} />
          <Divider />
          <Text size="xs" color="secondary" className="pt-2.5">
            Display only — shown as progress toward this figure, but it never triggers a payout or
            refund on its own.
          </Text>
        </Card>
      )}

      <Card padding="md">
        <PayoutRules pot={pot} />
      </Card>

      <Card padding="md">
        <RefundRules pot={pot} />
      </Card>
    </div>
  );
}
