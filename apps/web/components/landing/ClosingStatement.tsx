import { Container } from "@/components/ui/Container";
import { Heading } from "@/components/ui/Heading";
import { Text } from "@/components/ui/Text";
import { Highlight } from "@/components/ui/Highlight";
import { Button } from "@/components/ui/Button";
import { ArrowRight } from "lucide-react";

export function ClosingStatement() {
  return (
    <section className="border-t border-border bg-accent-soft py-16 sm:py-24">
      <Container maxWidth="3xl" className="text-center">
        <Heading level={2} font="display">
          If more than one person is putting in money, <Highlight>Glasspot</Highlight> fits.
        </Heading>
        <Text size="lg" color="secondary" className="mx-auto mt-5 max-w-2xl">
          Weddings, funerals, rent, dues, emergencies, business capital, community levies: anywhere
          group money currently lands in one person&apos;s personal account, on trust alone.
          That&apos;s the gap Glasspot closes.
        </Text>
        <Text size="lg" color="secondary" className="mx-auto mt-3 max-w-2xl">
          More payout rules and more ways to pay in are rolling out gradually. This is the
          foundation, not the finished shape.
        </Text>
        <Button href="/signup" size="lg" className="mt-8">
          Create a pot
          <ArrowRight className="h-4 w-4" strokeWidth={1.5} />
        </Button>
      </Container>
    </section>
  );
}
