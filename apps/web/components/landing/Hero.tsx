import { Button } from "@/components/ui/Button";
import { Heading } from "@/components/ui/Heading";
import { Text } from "@/components/ui/Text";
import { Container } from "@/components/ui/Container";
import { AvatarStack } from "@/components/ui/AvatarStack";
import { Highlight } from "@/components/ui/Highlight";
import { ArrowRight, Lock } from "lucide-react";

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
          Contributions that move by <Highlight>agreed rules</Highlight>, in plain sight.
        </Heading>
        <Text size="lg" color="secondary" className="max-w-xl">
          Set the rule before anyone pays. Whether it fires automatically or an admin triggers
          it, every move is visible to the contributors.
        </Text>
        <div className="sm:flex space-y-3 sm:space-y-0 gap-3 sm:flex-row">
          <Button href="/signup" size="lg" className="w-full sm:w-[unset]">
            Get started
            <ArrowRight className="h-4 w-4" strokeWidth={1.5} />
          </Button>
          <Button href="#how-it-works" variant="secondary" size="lg" className="w-full sm:w-[unset]">
            See how it works
          </Button>
        </div>
        <div className="flex items-start gap-2 rounded-lg bg-accent-soft px-3.5 py-2.5 text-accent">
          <Lock className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.5} />
          <Text size="sm" color="accent">
            The rule locks the moment the pot goes live. Nobody can quietly change it, not
            even the creator.
          </Text>
        </div>
        <div className="mt-2">
          <AvatarStack names={["Ada O", "Tunde B", "Chiamaka N", "Bayo A"]} />
        </div>
      </Container>
    </section>
  );
}
