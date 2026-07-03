import { Card } from "@/components/ui/Card";
import { Text } from "@/components/ui/Text";
import { Money } from "@/components/ui/Money";
import { Divider } from "@/components/ui/Divider";
import { nigerianBanks } from "@/lib/mock/fixtures";
import { payoutModeLabels } from "@/components/pot/PayoutModeIcon";
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
          value={state.minContributionKobo ? <Money kobo={Number(state.minContributionKobo) * 100} /> : "None set"}
        />
        {state.maxContributionKobo && (
          <>
            <Divider />
            <Row label="Maximum contribution" value={<Money kobo={Number(state.maxContributionKobo) * 100} />} />
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
                <Row label="Target amount" value={<Money kobo={Number(state.targetAmountNaira) * 100} />} />
              </>
            )}
            {state.adminManualEnabled && (
              <>
                <Divider />
                <Row label="Manual trigger" value="Admins can trigger anytime" />
              </>
            )}
          </>
        )}

        {state.payoutMode === "manual" && (
          <>
            <Divider />
            <Row label="Payout account" value="Chosen by the admin when they trigger it" />
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
              value={state.recurringAmountNaira ? <Money kobo={Number(state.recurringAmountNaira) * 100} /> : "Not set"}
            />
            <Divider />
            <Row label="Repeats every" value={`${state.recurringIntervalDays} days`} />
            <Divider />
            <Row label="First payout" value={state.recurringNextRunAt || "Not set"} />
          </>
        )}

        {state.payoutMode === "rotation" && (
          <>
            <Divider />
            {state.rotationLegs.map((leg, index) => (
              <div key={index}>
                <Row
                  label={`Turn ${index + 1}`}
                  value={
                    <div className="flex flex-col items-end gap-0.5">
                      <span>{leg.destinationAccount || "Not set"} · {bankName(leg.destinationBank)}</span>
                      <span className="text-text-secondary">
                        {leg.amountKobo ? <Money kobo={Number(leg.amountKobo) * 100} size="xs" color="secondary" /> : null}
                        {leg.scheduledDate ? ` on ${leg.scheduledDate}` : ""}
                      </span>
                    </div>
                  }
                />
                {index < state.rotationLegs.length - 1 && <Divider />}
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
