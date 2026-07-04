import { Fragment } from "react";
import { ArrowRight } from "lucide-react";
import { Container } from "@/components/ui/Container";
import { Card } from "@/components/ui/Card";
import { Heading } from "@/components/ui/Heading";
import { Text } from "@/components/ui/Text";

const stepBadgeTone = [
  "bg-accent-soft text-accent ring-4 ring-accent/10",
  "bg-amber-soft text-amber ring-4 ring-amber/10",
  "bg-indigo-soft text-indigo ring-4 ring-indigo/10",
];

const steps = [
  {
    title: "Create a pot, set the rule",
    description:
      "Pick who it's for, how it pays out (a target, a date, a rotation, or a trusted trigger) and how refunds work if it doesn't.",
  },
  {
    title: "Everyone contributes",
    description:
      "Each contributor gets their own virtual account, powered by Nomba. Pay in, and it's visible to the whole group immediately.",
  },
  {
    title: "The rule decides, not a person",
    description:
      "When the target's hit, the date arrives, or a trusted member acts, the payout fires and everyone in the pot sees it happen. No guessing, no chasing.",
  },
];

export function HowItWorks() {
  return (
    <section id="how-it-works" className="border-t border-border bg-surface py-16 sm:py-24">
      <Container>
        <Heading level={2} font="display" className="max-w-xl">
          How it works
        </Heading>
        <div className="mt-10 flex flex-col items-stretch gap-4 sm:flex-row sm:items-center sm:gap-3">
          {steps.map((step, index) => (
            <Fragment key={step.title}>
              <Card padding="lg" className="flex flex-1 flex-col gap-4">
                <span
                  className={`flex h-12 w-12 items-center justify-center rounded-full font-display text-lg font-semibold ${stepBadgeTone[index]}`}
                >
                  {index + 1}
                </span>
                <Heading level={4}>{step.title}</Heading>
                <Text color="secondary" size="sm">
                  {step.description}
                </Text>
              </Card>
              {index < steps.length - 1 && (
                <ArrowRight
                  className="mx-auto h-5 w-5 shrink-0 rotate-90 text-text-secondary sm:mx-0 sm:rotate-0"
                  strokeWidth={1.5}
                />
              )}
            </Fragment>
          ))}
        </div>
      </Container>
    </section>
  );
}
