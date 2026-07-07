"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeftRight, Compass, Home, Plus, User } from "lucide-react";
import { GlasspotFullLogo } from "@/components/brand/GlasspotLogo";
import { Text } from "@/components/ui/Text";
import { cn } from "@/lib/cn";
import { useMockStore } from "@/lib/mock/store";

const links = [
  { href: "/dashboard", label: "Home", icon: Home },
  { href: "/discover", label: "Explore", icon: Compass },
  { href: "/activity", label: "Activity", icon: ArrowLeftRight },
  { href: "/profile", label: "Profile", icon: User },
];

export function Sidebar() {
  const pathname = usePathname();
  const { currentUser, pots, members } = useMockStore();

  const myPotIds = new Set(
    members.filter((member) => member.userId === currentUser?.id).map((member) => member.potId)
  );
  const myPots = pots.filter((pot) => myPotIds.has(pot.id));
  const openCount = myPots.filter((pot) => pot.status === "open").length;
  const pendingCount = myPots.filter((pot) => pot.pendingOperation).length;

  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-border bg-surface lg:flex">
      <div className="px-5 pt-6">
        <Link href="/dashboard">
          <GlasspotFullLogo size={26} />
        </Link>
      </div>

      {currentUser && (
        <Link href="/profile" className="mx-4 mt-8 block rounded-md border border-border px-3 py-3 transition-colors duration-150 hover:bg-surface-hover">
          <Text size="sm" weight="medium" className="truncate">
            {currentUser.fullName}
          </Text>
          <Text size="xs" color="secondary" className="truncate">
            @{currentUser.username}
          </Text>
        </Link>
      )}

      <nav className="flex flex-1 flex-col gap-2 px-3 pb-3 pt-8">
        {links.map((link) => {
          const isActive = pathname === link.href || pathname.startsWith(`${link.href}/`);
          const Icon = link.icon;
          return (
            <Link
              key={link.href}
              href={link.href}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors duration-150",
                isActive ? "bg-accent-soft text-accent" : "text-text-secondary hover:bg-surface-hover hover:text-text-primary"
              )}
            >
              <span
                className={cn(
                  "flex h-8 w-8 shrink-0 items-center justify-center rounded-md",
                  isActive ? "bg-accent text-white" : "bg-surface-hover text-text-secondary"
                )}
              >
                <Icon className="h-4 w-4" strokeWidth={1.5} />
              </span>
              {link.label}
            </Link>
          );
        })}
      </nav>

      <div className="px-4 pb-5">
        <div className="rounded-md bg-accent p-4 text-white">
          <Text size="xs" className="text-white/70">
            {openCount} open {openCount === 1 ? "pot" : "pots"}
          </Text>
          <Text size="sm" weight="medium" className="mt-0.5 text-white">
            {pendingCount > 0
              ? `${pendingCount} awaiting a payout or refund`
              : "Nothing pending right now"}
          </Text>
          <Link
            href="/pots/new"
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-md bg-white px-4 py-2.5 text-sm font-medium text-accent transition-colors duration-150 hover:bg-white/90"
          >
            <Plus className="h-4 w-4" strokeWidth={1.5} />
            New pot
          </Link>
        </div>
      </div>
    </aside>
  );
}
