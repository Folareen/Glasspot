import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { GlasspotFullLogo } from "@/components/brand/GlasspotLogo";

type AuthCardProps = {
  children: React.ReactNode;
};

export function AuthCard({ children }: AuthCardProps) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-5 py-12">
      <div className="w-full max-w-104">
        <Link href="/" className="mb-8 flex justify-center">
          <GlasspotFullLogo size={40} />
        </Link>
        <Card padding="lg">{children}</Card>
      </div>
    </div>
  );
}
