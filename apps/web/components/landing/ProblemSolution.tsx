import { Container } from "@/components/ui/Container";
import { Card } from "@/components/ui/Card";
import { Heading } from "@/components/ui/Heading";
import { Text } from "@/components/ui/Text";
import { Check, Minus } from "lucide-react";

const usualWay = [
  "One person's personal account holds everyone's money",
  "Only that person can see the real total",
  "Nothing stops the money moving early, or not at all",
  "Everyone else just has to trust them",
];

const glasspotWay = [
  "Money sits in its own pot, never a personal account",
  "Every contributor sees the total and every move made",
  "Payout only fires when the rule the group agreed on is met",
  "Trust is enforced by the rule, not a personal favor",
];

export function ProblemSolution() {
  return (
    <section className="py-16 sm:py-24">
      <Container>
        <div className="max-w-2xl">
          <Heading level={2} font="display">
            The problem isn&apos;t the people. It&apos;s the order of operations.
          </Heading>
          <Text size="lg" color="secondary" className="mt-4">
            When money from a group lands in one person&apos;s account first, trust is the only
            thing holding it together. Glasspot just changes what happens first.
          </Text>
          <Text size="lg" color="secondary" className="mt-4">
            No complicated dashboards, no crypto wallet learning curve. If you can do a bank
            transfer, you already know how to use Glasspot.
          </Text>
        </div>
        <div className="mt-10 grid gap-4 sm:grid-cols-2">
          <Card padding="lg">
            <Text size="sm" weight="medium" color="secondary" className="uppercase tracking-wide">
              The usual way
            </Text>
            <ul className="mt-5 flex flex-col gap-4">
              {usualWay.map((item) => (
                <li key={item} className="flex items-start gap-3">
                  <Minus className="mt-0.5 h-4 w-4 shrink-0 text-text-secondary" strokeWidth={1.5} />
                  <Text color="secondary">{item}</Text>
                </li>
              ))}
            </ul>
          </Card>
          <Card padding="lg" tone="accent">
            <Text size="sm" weight="medium" color="accent" className="uppercase tracking-wide">
              The Glasspot way
            </Text>
            <ul className="mt-5 flex flex-col gap-4">
              {glasspotWay.map((item) => (
                <li key={item} className="flex items-start gap-3">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-accent" strokeWidth={1.5} />
                  <Text color="primary">{item}</Text>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </Container>
    </section>
  );
}
