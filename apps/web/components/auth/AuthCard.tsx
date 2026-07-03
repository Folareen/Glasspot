import Link from "next/link";
import { Card } from "@/components/ui/Card";

type AuthCardProps = {
  children: React.ReactNode;
};

export function AuthCard({ children }: AuthCardProps) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-5 py-12">
      <div className="w-full max-w-sm">
        <Link
          href="/"
          className="mb-8 flex justify-center font-display text-2xl font-semibold text-text-primary"
        >
          Glasspot
        </Link>
        <Card padding="lg">{children}</Card>
      </div>
    </div>
  );
}
