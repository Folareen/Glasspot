import Image from "next/image";
import { cn } from "@/lib/cn";

type LogoVariant = "default" | "white" | "dark";

const wordmarkStyles: Record<LogoVariant, string> = {
  default: "text-text-primary",
  white: "text-white",
  dark: "text-[#1B4332]",
};

type GlasspotMarkProps = {
  size?: number;
  className?: string;
};

export function GlasspotMark({ size = 32, className }: GlasspotMarkProps) {
  return (
    <Image
      src="/glasspot-mark.svg"
      alt="Glasspot"
      width={size}
      height={size}
      className={cn("shrink-0", className)}
    />
  );
}

type GlasspotFullLogoProps = {
  size?: number;
  variant?: LogoVariant;
  className?: string;
};

export function GlasspotFullLogo({ size = 32, variant = "default", className }: GlasspotFullLogoProps) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <GlasspotMark size={size} />
      <span
        className={cn(
          "font-display font-semibold leading-none",
          wordmarkStyles[variant]
        )}
        style={{ fontSize: size * 0.65 }}
      >
        Glasspot
      </span>
    </span>
  );
}

export const GlasspotLogo = GlasspotFullLogo;
