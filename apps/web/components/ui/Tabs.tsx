"use client";

import { useState } from "react";
import { cn } from "@/lib/cn";

type Tab = {
  id: string;
  label: string;
};

type TabsProps = {
  tabs: Tab[];
  defaultTabId?: string;
  children: (activeTabId: string) => React.ReactNode;
};

export function Tabs({ tabs, defaultTabId, children }: TabsProps) {
  const [activeTabId, setActiveTabId] = useState(defaultTabId ?? tabs[0]?.id);

  return (
    <div>
      <div role="tablist" className="flex flex-wrap gap-2">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setActiveTabId(tab.id)}
              className={cn(
                "h-11 rounded-full px-4 text-sm font-medium transition-colors duration-150",
                isActive
                  ? "bg-accent text-white"
                  : "border border-border bg-surface text-text-secondary hover:text-text-primary"
              )}
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
