import { Container } from "@/components/ui/Container";
import { Card } from "@/components/ui/Card";
import { Heading } from "@/components/ui/Heading";
import { Text } from "@/components/ui/Text";
import { Badge } from "@/components/ui/Badge";
import { Target, ShieldCheck, Calendar, Repeat, type LucideIcon } from "lucide-react";
import {
  featuredUseCases,
  payoutModeMeta,
  potTypeBadge,
  refundTypeBadge,
  type MvpPayoutMode,
} from "./use-cases-data";

const iconForMode: Record<MvpPayoutMode, LucideIcon> = {
  target_based: Target,
  manual: ShieldCheck,
  recurring: Repeat,
  scheduled: Calendar,
};

const badgeToneForMode: Record<MvpPayoutMode, string> = {
  target_based: "bg-amber-soft text-amber",
  manual: "bg-indigo-soft text-indigo",
  recurring: "bg-rose-soft text-rose",
  scheduled: "bg-accent-soft text-accent",
};

export function FeaturedUseCases() {
  return (
    <section id="use-cases" className="py-16 sm:py-24">
      <Container>
        <div className="max-w-2xl">
          <Heading level={2} font="display">
            Built for how Nigerians already pool money
          </Heading>
          <Text size="lg" color="secondary" className="mt-4">
            These are the situations Glasspot fits best today, one for each of the four ways a
            pot can pay out.
          </Text>
        </div>
        <div className="mt-10 grid gap-4 sm:grid-cols-2">
          {featuredUseCases.map((useCase) => {
            const Icon = iconForMode[useCase.payoutMode];
            return (
              <Card key={useCase.id} padding="lg" className="flex flex-col gap-4">
                <div className="flex items-center justify-between">
                  <span
                    className={`flex h-11 w-11 items-center justify-center rounded-md ${badgeToneForMode[useCase.payoutMode]}`}
                  >
                    <Icon className="h-5 w-5" strokeWidth={1.5} />
                  </span>
                  <Badge variant="outline">{payoutModeMeta[useCase.payoutMode].label}</Badge>
                </div>
                <Heading level={3}>{useCase.title}</Heading>
                <Text color="secondary">{useCase.description}</Text>
                <div className="mt-auto flex flex-wrap gap-2 pt-2">
                  <Badge>{potTypeBadge[useCase.potType]}</Badge>
                  <Badge>{refundTypeBadge[useCase.refundType]}</Badge>
                </div>
              </Card>
            );
          })}
        </div>
      </Container>
    </section>
  );
}
