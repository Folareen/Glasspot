import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Text } from "@/components/ui/Text";
import type { MemberResponse } from "@/lib/mock/types";

type MemberRowProps = {
  member: MemberResponse;
  action?: React.ReactNode;
};

export function MemberRow({ member, action }: MemberRowProps) {
  const isPending = member.status === "pending";

  return (
    <div className="flex items-center justify-between gap-3 py-3">
      <div className="flex items-center gap-3 min-w-0">
        <Avatar name={isPending ? member.email : member.fullName} size="sm" />
        <div className="min-w-0">
          <Text weight="medium" className="truncate">
            {isPending ? member.email : member.fullName}
          </Text>
          <Text size="xs" color="secondary" className="truncate">
            {isPending ? "Invited — pending signup" : `@${member.username}`}
          </Text>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {isPending && <Badge variant="amber">Pending</Badge>}
        {member.role === "admin" && <Badge variant="accent">Admin</Badge>}
        {action}
      </div>
    </div>
  );
}
