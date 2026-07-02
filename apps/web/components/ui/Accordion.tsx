"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn";
import { Text } from "./Text";

type AccordionItem = {
  question: string;
  answer: string;
};

type AccordionProps = {
  items: AccordionItem[];
  defaultOpenIndex?: number | null;
};

export function Accordion({ items, defaultOpenIndex = 0 }: AccordionProps) {
  const [openIndex, setOpenIndex] = useState<number | null>(defaultOpenIndex);

  return (
    <div className="divide-y divide-border border-t border-border">
      {items.map((item, index) => {
        const isOpen = openIndex === index;
        return (
          <div key={item.question}>
            <button
              type="button"
              onClick={() => setOpenIndex(isOpen ? null : index)}
              aria-expanded={isOpen}
              className="flex w-full items-center justify-between gap-4 py-5 text-left"
            >
              <Text as="span" weight="medium" size="lg">
                {item.question}
              </Text>
              <ChevronDown
                className={cn(
                  "h-5 w-5 shrink-0 text-text-secondary transition-transform duration-200",
                  isOpen && "rotate-180"
                )}
                strokeWidth={1.5}
              />
            </button>
            <div
              className={cn(
                "grid transition-all duration-200 ease-out",
                isOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
              )}
            >
              <div className="overflow-hidden">
                <Text color="secondary" className="max-w-2xl pb-5 pr-8">
                  {item.answer}
                </Text>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
