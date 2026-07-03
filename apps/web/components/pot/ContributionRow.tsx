import { Money } from "@/components/ui/Money";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Text } from "@/components/ui/Text";
import type { ContributionResponse } from "@/lib/mock/types";

type ContributionRowProps = {
  contribution: ContributionResponse;
};

export function ContributionRow({ contribution }: ContributionRowProps) {
  const name = contribution.anonymous ? "Anonymous" : contribution.contributorName;

  return (
    <div className="flex items-center justify-between gap-3 py-3">
      <div className="min-w-0">
        <Text weight="medium" className="truncate">
          {name}
        </Text>
        {contribution.status === "underpaid" ? (
          <Text size="xs" color="secondary">
            Paid <Money kobo={contribution.paidAmountKobo} size="xs" color="secondary" /> of{" "}
            <Money kobo={contribution.expectedAmountKobo} size="xs" color="secondary" />
          </Text>
        ) : (
          <Text size="xs" color="secondary">
            {new Date(contribution.createdAt).toLocaleDateString("en-NG", { day: "numeric", month: "short" })}
          </Text>
        )}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <Money kobo={contribution.expectedAmountKobo} className="font-medium" />
        <StatusBadge status={contribution.status} />
      </div>
    </div>
  );
}
