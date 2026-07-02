import { Button } from "@/components/ui/Button";
import { Heading } from "@/components/ui/Heading";
import { Text } from "@/components/ui/Text";
import { Container } from "@/components/ui/Container";
import { AvatarStack } from "@/components/ui/AvatarStack";
import { Highlight } from "@/components/ui/Highlight";
import { ArrowRight, Lock, Users } from "lucide-react";

export function Hero() {
  return (
    <section className="relative overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-24 right-[-12%] hidden h-130 w-130 rounded-full border border-border sm:block"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute top-28 right-[8%] hidden h-56 w-56 rounded-full border border-border sm:block"
      />
      <Container className="relative flex flex-col items-start gap-8 py-16 sm:py-24">
        <Heading level={1} font="display" as="h1" className="max-w-3xl">
          Group money, governed by <Highlight>the rule</Highlight> everyone agreed on first.
        </Heading>
        <Text size="lg" color="secondary" className="max-w-xl">
          Glasspot is a shared pot for money from more than one person, for weddings, dues, rent,
          emergencies and more. The group agrees on the rule before anyone contributes. Money
          only moves when that rule is met, or a trusted member acts, and every move stays
          visible to everyone in the pot.
        </Text>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Button href="/signup" size="lg">
            Get started
            <ArrowRight className="h-4 w-4" strokeWidth={1.5} />
          </Button>
          <Button href="#how-it-works" variant="secondary" size="lg">
            See how it works
          </Button>
        </div>
        <div className="flex items-start gap-2 text-text-secondary">
          <Lock className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.5} />
          <Text size="sm" color="secondary">
            The rule locks the moment the pot goes live. Nobody can quietly change it, not
            even the creator.
          </Text>
        </div>
        <div className="mt-2 flex flex-col items-start gap-3 sm:flex-row sm:items-start">
          <AvatarStack names={["Ada O", "Tunde B", "Chiamaka N", "Bayo A"]} />
          <div className="flex items-start gap-1.5 text-text-secondary">
            <Users className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.5} />
            <Text size="sm" color="secondary">
              For every kind of group: family, coworkers, classmates, associations.
            </Text>
          </div>
        </div>
      </Container>
    </section>
  );
}
