"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronRight, LogOut, Wallet } from "lucide-react";
import { AppHeader } from "@/components/layout/AppHeader";
import { Avatar } from "@/components/ui/Avatar";
import { Card } from "@/components/ui/Card";
import { Container } from "@/components/ui/Container";
import { Heading } from "@/components/ui/Heading";
import { Text } from "@/components/ui/Text";
import { useMockStore } from "@/lib/mock/store";
import { useToast } from "@/lib/toast";
import { nigerianBanks } from "@/lib/mock/fixtures";

export default function ProfilePage() {
  const { currentUser, logout } = useMockStore();
  const { showToast } = useToast();
  const router = useRouter();

  const bank = nigerianBanks.find((b) => b.code === currentUser?.defaultRefundBank);
  const hasRefundAccount = Boolean(currentUser?.defaultRefundAccount && bank);

  function handleLogout() {
    logout();
    showToast("Logged out");
    router.push("/login");
  }

  return (
    <>
      <AppHeader title="Profile" />
      <Container className="py-6">
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

        <div className="flex flex-col gap-3">
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

          <button type="button" onClick={handleLogout} className="block w-full text-left">
            <Card padding="sm" className="transition-colors duration-150 hover:bg-surface-hover">
              <div className="flex items-center gap-3">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-error-soft text-error">
                  <LogOut className="h-5 w-5" strokeWidth={1.5} />
                </span>
                <Text weight="medium" className="flex-1">
                  Log out
                </Text>
              </div>
            </Card>
          </button>
        </div>
      </Container>
    </>
  );
}
