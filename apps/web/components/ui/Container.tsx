import { cn } from "@/lib/cn";

type ContainerMaxWidth = "2xl" | "3xl" | "6xl";

const maxWidthStyles: Record<ContainerMaxWidth, string> = {
  "2xl": "max-w-2xl",
  "3xl": "max-w-3xl",
  "6xl": "max-w-6xl",
};

type ContainerProps = {
  children: React.ReactNode;
  maxWidth?: ContainerMaxWidth;
  className?: string;
};

export function Container({ children, maxWidth = "6xl", className }: ContainerProps) {
  return (
    <div className={cn("mx-auto w-full px-5 sm:px-8", maxWidthStyles[maxWidth], className)}>
      {children}
    </div>
  );
}
