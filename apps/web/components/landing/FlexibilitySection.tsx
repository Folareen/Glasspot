import { Container } from "@/components/ui/Container";
import { Card } from "@/components/ui/Card";
import { Heading } from "@/components/ui/Heading";
import { Text } from "@/components/ui/Text";
import { Badge } from "@/components/ui/Badge";
import {
  payoutModeMeta,
  refundTypeBadge,
  potTypeBadge,
  type MvpPayoutMode,
  type RefundType,
  type PotType,
} from "./use-cases-data";

const payoutChoices = Object.keys(payoutModeMeta) as MvpPayoutMode[];
const refundChoices: RefundType[] = ["contributors", "admin"];
const potChoices: PotType[] = ["private", "public"];

const decisions = [
  {
    question: "How should it pay out?",
    chips: payoutChoices.map((mode) => payoutModeMeta[mode].label),
  },
  {
    question: "How should refunds work?",
    chips: refundChoices.map((type) => refundTypeBadge[type]),
  },
  {
    question: "Who can see and contribute?",
    chips: potChoices.map((type) => potTypeBadge[type]),
  },
];

export function FlexibilitySection() {
  return (
    <section className="border-t border-border bg-amber-soft py-16 sm:py-24">
      <Container>
        <div className="max-w-2xl">
          <Heading level={2} font="display">
            The rules are yours to set
          </Heading>
          <Text size="lg" color="secondary" className="mt-4">
            Pick how it pays out, how refunds work, and who can see it. Mix and match to fit
            exactly what your group needs, nothing forced, nothing generic.
          </Text>
        </div>
        <div className="mt-10 grid gap-4 sm:grid-cols-3">
          {decisions.map((decision) => (
            <Card key={decision.question} padding="lg" className="flex flex-col gap-4">
              <Text weight="medium">{decision.question}</Text>
              <div className="flex flex-wrap gap-2">
                {decision.chips.map((chip) => (
                  <Badge key={chip} variant="outline">
                    {chip}
                  </Badge>
                ))}
              </div>
            </Card>
          ))}
        </div>
      </Container>
    </section>
  );
}
