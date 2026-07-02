import { cn } from "@/lib/cn";

const palette = [
  { bg: "bg-accent-soft", text: "text-accent" },
  { bg: "bg-success-soft", text: "text-success" },
  { bg: "bg-surface-hover", text: "text-text-secondary" },
];

function paletteFor(name: string) {
  const index = name.charCodeAt(0) % palette.length;
  return palette[index];
}

function initials(name: string) {
  return name
    .split(" ")
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

type AvatarSize = "sm" | "md";

const sizeStyles: Record<AvatarSize, string> = {
  sm: "h-8 w-8 text-xs",
  md: "h-10 w-10 text-sm",
};

type AvatarProps = {
  name: string;
  size?: AvatarSize;
  className?: string;
};

export function Avatar({ name, size = "md", className }: AvatarProps) {
  const { bg, text } = paletteFor(name);
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full font-medium ring-2 ring-surface",
        sizeStyles[size],
        bg,
        text,
        className
      )}
    >
      {initials(name)}
    </span>
  );
}
