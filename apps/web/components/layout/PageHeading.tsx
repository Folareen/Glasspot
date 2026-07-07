import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Heading } from "@/components/ui/Heading";

type PageHeadingProps = {
  title: string;
  backHref?: string;
  backLabel?: string;
  action?: React.ReactNode;
  className?: string;
};

export function PageHeading({ title, backHref, backLabel = "Back", action, className }: PageHeadingProps) {
  return (
    <div className={className}>
      {backHref && (
        <Link
          href={backHref}
          className="mb-3 inline-flex items-center gap-1.5 text-sm font-medium text-text-secondary transition-colors duration-150 hover:text-text-primary"
        >
          <ArrowLeft className="h-4 w-4" strokeWidth={1.5} />
          {backLabel}
        </Link>
      )}
      <div className="flex items-center justify-between gap-3">
        <Heading level={2} font="sans" className="truncate">
          {title}
        </Heading>
        {action && <div className="flex shrink-0 items-center">{action}</div>}
      </div>
    </div>
  );
}
