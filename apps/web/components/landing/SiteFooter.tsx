import Link from "next/link";
import { Container } from "@/components/ui/Container";
import { Text } from "@/components/ui/Text";

const linkClasses = "py-1.5 text-sm text-text-secondary transition-colors hover:text-text-primary";

export function SiteFooter() {
  return (
    <footer className="border-t border-border py-12">
      <Container className="flex flex-col gap-10 sm:flex-row sm:justify-between">
        <div className="max-w-xs">
          <span className="font-display text-lg font-semibold text-text-primary">Glasspot</span>
          <Text size="sm" color="secondary" className="mt-1">
            Group money, governed by agreement.
          </Text>
          <Text size="xs" color="secondary" className="mt-4">
            Payments powered by Nomba.
          </Text>
          <Text size="xs" color="secondary" className="mt-1">
            Built for the Nomba 2026 Hackathon.
          </Text>
        </div>
        <div className="flex gap-16">
          <div className="flex flex-col gap-1">
            <Text size="xs" weight="medium" color="secondary" className="uppercase tracking-wide">
              Product
            </Text>
            <Link href="#how-it-works" className={linkClasses}>
              How it works
            </Link>
            <Link href="#use-cases" className={linkClasses}>
              Use cases
            </Link>
            <Link href="#faq" className={linkClasses}>
              FAQ
            </Link>
            <Link href="/about" className={linkClasses}>
              About
            </Link>
          </div>
          <div className="flex flex-col gap-1">
            <Text size="xs" weight="medium" color="secondary" className="uppercase tracking-wide">
              Account
            </Text>
            <Link href="/login" className={linkClasses}>
              Log in
            </Link>
            <Link href="/signup" className={linkClasses}>
              Sign up
            </Link>
          </div>
        </div>
      </Container>
      <Container>
        <Text size="xs" color="secondary" className="mt-10">
          © {new Date().getFullYear()} Glasspot. All rights reserved.
        </Text>
      </Container>
    </footer>
  );
}
