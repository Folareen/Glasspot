import { Card } from "@/components/ui/Card";
import { Text } from "@/components/ui/Text";
import { Money } from "@/components/ui/Money";
import { Divider } from "@/components/ui/Divider";
import { nigerianBanks } from "@/lib/mock/fixtures";
import { payoutModeLabels } from "@/components/pot/PayoutModeIcon";
import { toNairaAmount } from "@/lib/money";
import type { WizardState } from "./wizard-types";

type ReviewStepProps = {
  state: WizardState;
};

function bankName(code: string) {
  return nigerianBanks.find((bank) => bank.code === code)?.name ?? code;
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

export function ReviewStep({ state }: ReviewStepProps) {
  return (
    <div className="flex flex-col gap-4">
      <Card padding="md">
        <Row label="Title" value={state.title} />
        <Divider />
        <Row label="Visibility" value={state.potType === "public" ? "Public" : "Private"} />
        <Divider />
        <Row
          label="If it doesn't pay out"
          value={state.refundType === "admin" ? "Admin gets it back" : "Each contributor gets their own back"}
        />
        <Divider />
        <Row
          label="Minimum contribution"
          value={state.minContribution ? <Money naira={toNairaAmount(state.minContribution) ?? "0.00"} /> : "None set"}
        />
        {state.maxContribution && (
          <>
            <Divider />
            <Row label="Maximum contribution" value={<Money naira={toNairaAmount(state.maxContribution) ?? "0.00"} />} />
          </>
        )}
      </Card>

      <Card padding="md">
        <Row label="Payout mode" value={state.payoutMode ? payoutModeLabels[state.payoutMode] : "Not set"} />

        {state.payoutMode === "target_based" && (
          <>
            <Divider />
            <Row
              label="Payout account"
              value={`${state.targetDestinationAccount || "Not set"} · ${bankName(state.targetDestinationBank)}`}
            />
            {state.targetDate && (
              <>
                <Divider />
                <Row label="Target date" value={state.targetDate} />
              </>
            )}
            {state.targetAmountNaira && (
              <>
                <Divider />
                <Row label="Target amount" value={<Money naira={toNairaAmount(state.targetAmountNaira) ?? "0.00"} />} />
              </>
            )}
          </>
        )}

        {state.payoutMode === "manual" && (
          <>
            <Divider />
            <Row
              label="Payout account"
              value={
                state.manualDestinationAccount && state.manualDestinationBank
                  ? `${state.manualDestinationAccount} · ${bankName(state.manualDestinationBank)}`
                  : "Chosen by the admin when they trigger it"
              }
            />
          </>
        )}

        {state.payoutMode === "recurring" && (
          <>
            <Divider />
            <Row
              label="Payout account"
              value={`${state.recurringDestinationAccount || "Not set"} · ${bankName(state.recurringDestinationBank)}`}
            />
            <Divider />
            <Row
              label="Amount per payout"
              value={
                state.recurringAmountNaira ? (
                  <Money naira={toNairaAmount(state.recurringAmountNaira) ?? "0.00"} />
                ) : (
                  "Not set"
                )
              }
            />
            <Divider />
            <Row label="Repeats every" value={`${state.recurringIntervalDays} days`} />
            <Divider />
            <Row label="First payout" value={state.recurringNextRunAt || "Not set"} />
          </>
        )}

        {state.payoutMode === "scheduled" && (
          <>
            <Divider />
            <Row label="Order" value={state.scheduledOrdered ? "In order (ajo/esusu style)" : "Independent, on each own date"} />
            <Divider />
            {state.scheduledLegs.map((leg, index) => (
              <div key={index}>
                <Row
                  label={state.scheduledOrdered ? `Turn ${index + 1}` : `Payout ${index + 1}`}
                  value={
                    <div className="flex flex-col items-end gap-0.5">
                      <span>{leg.destinationAccount || "Not set"} · {bankName(leg.destinationBank)}</span>
                      <span className="text-text-secondary">
                        {leg.amount ? (
                          <Money naira={toNairaAmount(leg.amount) ?? "0.00"} size="xs" color="secondary" />
                        ) : null}
                        {leg.scheduledDate ? ` on ${leg.scheduledDate}` : ""}
                      </span>
                    </div>
                  }
                />
                {index < state.scheduledLegs.length - 1 && <Divider />}
              </div>
            ))}
          </>
        )}
      </Card>

      <Text size="xs" color="secondary">
        Your pot is created as a draft. You can review everything and change the payout rule
        before you open it up for contributions.
      </Text>
    </div>
  );
}
