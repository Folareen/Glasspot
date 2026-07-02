import { Avatar } from "./Avatar";

type AvatarStackProps = {
  names: string[];
  extraCount?: number;
};

export function AvatarStack({ names, extraCount = 0 }: AvatarStackProps) {
  return (
    <div className="flex -space-x-2">
      {names.map((name) => (
        <Avatar key={name} name={name} size="md" />
      ))}
      {extraCount > 0 && (
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-surface-hover text-xs font-medium text-text-secondary ring-2 ring-surface">
          +{extraCount}
        </span>
      )}
    </div>
  );
}
