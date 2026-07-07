"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeftRight, Compass, Home, User } from "lucide-react";
import { cn } from "@/lib/cn";

const tabs = [
  { href: "/home", label: "Home", icon: Home },
  { href: "/discover", label: "Explore", icon: Compass },
  { href: "/activity", label: "Activity", icon: ArrowLeftRight },
  { href: "/profile", label: "Profile", icon: User },
];

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] lg:hidden">
      <div className="mx-auto flex h-16 max-w-6xl items-stretch justify-around">
        {tabs.map((tab) => {
          const isActive = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
          const Icon = tab.icon;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={cn(
                "flex min-w-11 flex-1 flex-col items-center justify-center gap-1 text-xs font-medium transition-colors duration-150",
                isActive ? "text-accent" : "text-text-secondary"
              )}
            >
              <Icon className="h-6 w-6" strokeWidth={1.5} />
              {tab.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
