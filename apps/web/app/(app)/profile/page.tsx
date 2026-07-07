"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronRight, LogOut, Wallet } from "lucide-react";
import { AppHeader } from "@/components/layout/AppHeader";
import { PageHeading } from "@/components/layout/PageHeading";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Container } from "@/components/ui/Container";
import { Heading } from "@/components/ui/Heading";
import { Text } from "@/components/ui/Text";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/lib/toast";
import { useBanks } from "@/lib/useBanks";
import { logout as apiLogout } from "@/lib/api";

export default function ProfilePage() {
  const { currentUser, setCurrentUser } = useAuth();
  const { banks } = useBanks();
  const { showToast } = useToast();
  const router = useRouter();

  const bank = banks.find((b) => b.code === currentUser?.defaultRefundBank);
  const hasRefundAccount = Boolean(currentUser?.defaultRefundAccount && bank);

  async function handleLogout() {
    await apiLogout();
    setCurrentUser(null);
    showToast("Logged out");
    router.push("/login");
  }

  return (
    <>
      <AppHeader title="Profile" />
      <Container className="py-6 lg:py-10">
        <PageHeading title="Profile" className="mb-6 hidden lg:block" />
        {currentUser && (
          <div className="mb-8 flex items-center gap-4">
            <Avatar name={currentUser.fullName} size="md" />
            <div className="min-w-0">
              <Heading level={3} className="truncate">
                {currentUser.fullName}
              </Heading>
              <Text size="sm" color="secondary" className="truncate">
                @{currentUser.username} &middot; {currentUser.email}
              </Text>
            </div>
          </div>
        )}

        <div className="flex flex-col gap-3 max-w-sm">
          <Link href="/profile/refund-account" className="block">
            <Card padding="sm" className="transition-colors duration-150 hover:bg-surface-hover">
              <div className="flex items-center gap-3">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent">
                  <Wallet className="h-5 w-5" strokeWidth={1.5} />
                </span>
                <div className="min-w-0 flex-1">
                  <Text weight="medium">Refund account</Text>
                  {hasRefundAccount ? (
                    <Text size="sm" color="secondary">
                      {bank?.name} &middot; ****{currentUser?.defaultRefundAccount?.slice(-4)}
                    </Text>
                  ) : (
                    <Text size="sm" color="secondary">
                      Not set
                    </Text>
                  )}
                </div>
                <ChevronRight className="h-5 w-5 shrink-0 text-text-secondary" strokeWidth={1.5} />
              </div>
              <Text size="xs" color="secondary" className="mt-2">
                Required before you can trigger a refund as an admin.
              </Text>
            </Card>
          </Link>

          <Button variant="danger" className="w-max " onClick={handleLogout}>
            <LogOut className="h-4 w-4" strokeWidth={1.5} />
            Log out
          </Button>
        </div>
      </Container>
    </>
  );
}
