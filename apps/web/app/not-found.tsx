import { Button } from "@/components/ui/Button";
import { Heading } from "@/components/ui/Heading";
import { Text } from "@/components/ui/Text";
import { Container } from "@/components/ui/Container";
import { Highlight } from "@/components/ui/Highlight";
import { GlasspotMark } from "@/components/brand/GlasspotLogo";
import { ArrowRight, ArrowLeft } from "lucide-react";

export default function NotFound() {
  return (
    <section className="relative flex flex-1 items-center overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-24 right-[-12%] hidden h-130 w-130 rounded-full border border-border sm:block"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute top-28 right-[8%] hidden h-56 w-56 rounded-full border border-border sm:block"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-16 left-[-10%] hidden h-72 w-72 rounded-full border border-border sm:block"
      />
      <Container className="relative flex flex-col items-start gap-6 py-16 sm:py-24">
        <GlasspotMark size={40} className="opacity-60" />
        <Heading level={1} font="display" as="h1" className="max-w-xl">
          This pot doesn&apos;t <Highlight>exist</Highlight>.
        </Heading>
        <Text size="lg" color="secondary" className="max-w-md">
          The page you&apos;re looking for was moved, renamed, or never agreed to in the first
          place. Let&apos;s get you back to solid ground.
        </Text>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Button href="/" size="lg">
            Back to home
            <ArrowRight className="h-4 w-4" strokeWidth={1.5} />
          </Button>
          <Button href="/login" variant="secondary" size="lg">
            <ArrowLeft className="h-4 w-4" strokeWidth={1.5} />
            Go to login
          </Button>
        </div>
      </Container>
    </section>
  );
}
