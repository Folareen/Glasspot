"use client";

import { Children, useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn";

type SelectOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

type SelectProps = {
  id?: string;
  value: string;
  onChange: (event: { target: { value: string } }) => void;
  required?: boolean;
  disabled?: boolean;
  error?: boolean;
  className?: string;
  children: React.ReactNode;
};

// children arrives as a nested structure whenever a caller mixes static <option>s with a
// {list.map(...)} result — e.g. <Select><option/>{banks.map(...)}</Select> produces
// [optionElement, [optionElement, optionElement, ...]] — flat.map/for-of over the top level alone
// silently drops every option inside that inner array, which is exactly how this previously
// under-counted bank lists in every wizard step (only the static placeholder ever showed).
// React.Children.toArray recursively flattens (and key-namespaces) any such nesting.
function optionsFromChildren(children: React.ReactNode): SelectOption[] {
  const options: SelectOption[] = [];
  for (const child of Children.toArray(children)) {
    if (
      child &&
      typeof child === "object" &&
      "props" in child &&
      typeof child.props === "object" &&
      child.props !== null
    ) {
      const props = child.props as { value?: string; disabled?: boolean; children?: React.ReactNode };
      options.push({
        value: props.value ?? "",
        label: typeof props.children === "string" ? props.children : String(props.children ?? ""),
        disabled: props.disabled,
      });
    }
  }
  return options;
}

export function Select({ id, value, onChange, required, disabled, error, className, children }: SelectProps) {
  const [open, setOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = `${id ?? "select"}-listbox`;

  const options = useMemo(() => optionsFromChildren(children), [children]);
  const selected = options.find((option) => option.value === value);

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    listRef.current?.children[highlightedIndex]?.scrollIntoView({ block: "nearest" });
  }, [open, highlightedIndex]);

  function openList() {
    const index = options.findIndex((option) => option.value === value);
    setHighlightedIndex(index >= 0 ? index : 0);
    setOpen(true);
  }

  function selectOption(option: SelectOption) {
    if (option.disabled) return;
    onChange({ target: { value: option.value } });
    setOpen(false);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (disabled) return;

    if (!open) {
      if (["Enter", " ", "ArrowDown", "ArrowUp"].includes(event.key)) {
        event.preventDefault();
        openList();
      }
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlightedIndex((i) => Math.min(i + 1, options.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlightedIndex((i) => Math.max(i - 1, 0));
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      const option = options[highlightedIndex];
      if (option) selectOption(option);
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        id={id}
        type="button"
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={listId}
        aria-required={required}
        aria-invalid={error || undefined}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={handleKeyDown}
        className={cn(
          "flex h-12 w-full items-center justify-between rounded-sm border bg-surface px-4 text-base outline-none transition-colors focus:border-accent disabled:opacity-50 disabled:pointer-events-none",
          error ? "border-error focus:border-error" : "border-border",
          selected ? "text-text-primary" : "text-text-secondary",
          className
        )}
      >
        <span className="truncate">{selected?.label ?? "Select"}</span>
        <ChevronDown className="h-5 w-5 shrink-0 text-text-secondary" strokeWidth={1.5} />
      </button>

      {open && (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          className="absolute z-20 mt-1 max-h-60 w-full overflow-y-auto rounded-sm border border-border bg-surface py-1 shadow-md"
        >
          {options.map((option, index) => (
            <li
              key={option.value}
              role="option"
              aria-selected={option.value === value}
              onClick={() => selectOption(option)}
              onMouseEnter={() => setHighlightedIndex(index)}
              className={cn(
                "flex cursor-pointer items-center justify-between gap-2 px-4 py-2.5 text-base transition-colors",
                option.disabled
                  ? "cursor-not-allowed text-text-secondary opacity-50"
                  : index === highlightedIndex
                    ? "bg-accent-soft text-text-primary"
                    : "text-text-primary"
              )}
            >
              <span className="truncate">{option.label}</span>
              {option.value === value && <Check className="h-4 w-4 shrink-0 text-accent" strokeWidth={1.5} />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
