import { cn } from "@/lib/cn";

type HeadingLevel = 1 | 2 | 3 | 4;

const levelStyles: Record<HeadingLevel, string> = {
  1: "text-4xl sm:text-5xl md:text-6xl font-semibold tracking-tight leading-[1.05]",
  2: "text-3xl sm:text-4xl font-semibold tracking-tight leading-tight",
  3: "text-xl sm:text-2xl font-semibold leading-snug",
  4: "text-lg font-medium leading-snug",
};

const tagForLevel: Record<HeadingLevel, "h1" | "h2" | "h3" | "h4"> = {
  1: "h1",
  2: "h2",
  3: "h3",
  4: "h4",
};

type HeadingProps = {
  level?: HeadingLevel;
  as?: "h1" | "h2" | "h3" | "h4";
  font?: "display" | "sans";
  className?: string;
  id?: string;
  children: React.ReactNode;
};

export function Heading({
  level = 2,
  as,
  font = "sans",
  className,
  id,
  children,
}: HeadingProps) {
  const Tag = as ?? tagForLevel[level];
  return (
    <Tag
      id={id}
      className={cn(
        levelStyles[level],
        font === "display" ? "font-display" : "font-sans",
        "text-text-primary",
        className
      )}
    >
      {children}
    </Tag>
  );
}
