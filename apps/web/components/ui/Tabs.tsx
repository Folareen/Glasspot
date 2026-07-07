"use client";

import { useState } from "react";
import { cn } from "@/lib/cn";

type Tab = {
  id: string;
  label: string;
};

type TabsVariant = "pill" | "underline";

type TabsProps = {
  tabs: Tab[];
  defaultTabId?: string;
  variant?: TabsVariant;
  children: (activeTabId: string) => React.ReactNode;
};

export function Tabs({ tabs, defaultTabId, variant = "pill", children }: TabsProps) {
  const [activeTabId, setActiveTabId] = useState(defaultTabId ?? tabs[0]?.id);

  return (
    <div>
      <div
        role="tablist"
        className={cn(
          "flex",
          variant === "pill" ? "flex-wrap gap-2" : "gap-6 border-b border-border"
        )}
      >
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setActiveTabId(tab.id)}
              className={
                variant === "pill"
                  ? cn(
                      "h-11 rounded-full px-4 text-sm font-medium transition-colors duration-150",
                      isActive
                        ? "bg-accent text-white"
                        : "border border-border bg-surface text-text-secondary hover:text-text-primary"
                    )
                  : cn(
                      "-mb-px flex h-11 items-center border-b-2 px-1 text-sm font-medium transition-colors duration-150",
                      isActive
                        ? "border-accent text-accent"
                        : "border-transparent text-text-secondary hover:text-text-primary"
                    )
              }
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      <div className="mt-6">{children(activeTabId)}</div>
    </div>
  );
}
