import Link from "next/link";
import { Container } from "@/components/ui/Container";
import { Button } from "@/components/ui/Button";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background">
      <Container className="flex h-16 items-center justify-between">
        <Link
          href="/"
          className="flex h-11 items-center font-display text-xl font-semibold text-text-primary"
        >
          Glasspot
        </Link>
        <nav className="hidden items-center gap-8 sm:flex">
          <Link
            href="#how-it-works"
            className="text-sm font-medium text-text-secondary transition-colors hover:text-text-primary"
          >
            How it works
          </Link>
          <Link
            href="#use-cases"
            className="text-sm font-medium text-text-secondary transition-colors hover:text-text-primary"
          >
            Use cases
          </Link>
          <Link
            href="#faq"
            className="text-sm font-medium text-text-secondary transition-colors hover:text-text-primary"
          >
            FAQ
          </Link>
        </nav>
        <div className="flex items-center gap-5">
          <Link
            href="/login"
            className="hidden text-sm font-medium text-text-secondary transition-colors hover:text-text-primary sm:block"
          >
            Log in
          </Link>
          <Button href="/signup" size="sm">
            Get started
          </Button>
        </div>
      </Container>
    </header>
  );
}
