"use client";

import Link from "next/link";
import { GlasspotMark } from "@/components/brand/GlasspotLogo";
import { Button } from "@/components/ui/Button";
import { AppShell } from "@/components/layout/AppShell";
import { useAuth } from "@/lib/auth";

// This route is reachable without a session (a pot can be public — see
// proxy.ts's isProtectedPotRoute), so it can't unconditionally use AppShell:
// Sidebar/BottomNav assume a logged-in user with Home/Discover/Profile to
// navigate to. Logged-in visitors (the normal "open one of my pots" flow via
// PotCard) still get the full AppShell chrome; only an anonymous visitor
// gets the minimal logo + log-in header instead.
//
// Defaults to the minimal layout while auth is still resolving (isLoading),
// not AppShell — an anonymous visitor to a public pot link is the common
// case for this specific route, and defaulting to AppShell first meant
// every anonymous visitor saw a flash of the Sidebar/BottomNav chrome
// before it swapped to the plain header once getMe() resolved. A real
// logged-in session still upgrades to AppShell the moment isLoading clears.
export default function PotDetailLayout({ children }: { children: React.ReactNode }) {
  const { currentUser, isLoading } = useAuth();

  if (currentUser && !isLoading) {
    return <AppShell>{children}</AppShell>;
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-border bg-background px-5 sm:px-8">
        <Link href="/" className="flex h-11 items-center">
          <GlasspotMark size={28} />
        </Link>
        <Button href="/login" size="sm" variant="secondary">
          Log in
        </Button>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}
