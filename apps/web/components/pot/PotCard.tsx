import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { Heading } from "@/components/ui/Heading";
import { Money } from "@/components/ui/Money";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Text } from "@/components/ui/Text";
import { PayoutModeIcon, payoutModeLabels } from "./PayoutModeIcon";
import type { PotResponse } from "@/lib/mock/types";

type PotCardProps = {
  pot: PotResponse;
};

export function PotCard({ pot }: PotCardProps) {
  return (
    <Link href={`/pots/${pot.id}`} className="block">
      <Card className="transition-colors duration-150 hover:bg-surface-hover">
        <div className="flex items-start justify-between gap-3">
          <Heading level={4} className="truncate">
            {pot.title}
          </Heading>
          <StatusBadge status={pot.status} className="shrink-0" />
        </div>
        <div className="mt-3 flex items-end justify-between gap-3">
          <Money naira={pot.balance} size="lg" className="font-semibold" />
          <div className="flex items-center gap-1.5 text-text-secondary">
            <PayoutModeIcon mode={pot.payoutMode} className="h-4 w-4" />
            <Text size="xs" color="secondary">
              {payoutModeLabels[pot.payoutMode]}
            </Text>
          </div>
        </div>
      </Card>
    </Link>
  );
}
