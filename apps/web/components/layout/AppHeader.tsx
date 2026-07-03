import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Heading } from "@/components/ui/Heading";

type AppHeaderProps = {
  title: string;
  backHref?: string;
  action?: React.ReactNode;
};

export function AppHeader({ title, backHref, action }: AppHeaderProps) {
  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border bg-background px-5 sm:px-8">
      {backHref && (
        <Link
          href={backHref}
          className="flex h-11 w-11 shrink-0 items-center justify-center -ml-2 text-text-primary"
          aria-label="Go back"
        >
          <ArrowLeft className="h-5 w-5" strokeWidth={1.5} />
        </Link>
      )}
      <Heading level={4} font="sans" className="flex-1 truncate">
        {title}
      </Heading>
      {action && <div className="flex shrink-0 items-center">{action}</div>}
    </header>
  );
}
