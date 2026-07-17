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
  /** Controlled mode — pass both to drive the active tab from outside (e.g. to render the tab
   * bar and its content in different parts of the layout, such as a sticky header). */
  value?: string;
  onChange?: (tabId: string) => void;
};

type TabListProps = {
  tabs: Tab[];
  activeTabId: string;
  onChange: (tabId: string) => void;
  variant?: TabsVariant;
};

/** Just the tab button row, with no content pane — for layouts that render the bar and its
 * content in different places (e.g. a sticky header above a separately scrolling list). Tabs
 * itself uses this internally; reach for it directly when you need controlled placement. */
export function TabList({ tabs, activeTabId, onChange, variant = "pill" }: TabListProps) {
  return (
    <div
      role="tablist"
      className={cn("flex", variant === "pill" ? "flex-wrap gap-2" : "gap-6 border-b border-border")}
    >
      {tabs.map((tab) => {
        const isActive = tab.id === activeTabId;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(tab.id)}
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
  );
}

export function Tabs({ tabs, defaultTabId, variant = "pill", children, value, onChange }: TabsProps) {
  const [uncontrolledTabId, setUncontrolledTabId] = useState(defaultTabId ?? tabs[0]?.id);
  const activeTabId = value ?? uncontrolledTabId;
  const setActiveTabId = onChange ?? setUncontrolledTabId;

  return (
    <div>
      <TabList tabs={tabs} activeTabId={activeTabId} onChange={setActiveTabId} variant={variant} />
      <div className="mt-6">{children(activeTabId)}</div>
    </div>
  );
}
