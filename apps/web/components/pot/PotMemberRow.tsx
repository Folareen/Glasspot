import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { DataTableGridRow, type DataTableColumn } from "@/components/ui/DataTable";
import { Text } from "@/components/ui/Text";
import type { MemberResponse } from "@/lib/mock/types";

export const memberColumns: DataTableColumn[] = [
  { key: "member", label: "Member", width: "2fr" },
  { key: "role", label: "Role", width: "1fr" },
  { key: "status", label: "Status", width: "1fr", align: "right" },
];

type PotMemberRowProps = {
  member: MemberResponse;
  action?: React.ReactNode;
};

export function PotMemberRow({ member, action }: PotMemberRowProps) {
  const isPending = member.status === "pending";
  const displayName = isPending ? member.email : member.fullName;

  return (
    <>
      {/* Mobile: stacked row, own layout */}
      <div className="flex items-center justify-between gap-3 py-3 lg:hidden">
        <div className="flex min-w-0 items-center gap-3">
          <Avatar name={displayName} size="sm" />
          <div className="min-w-0">
            <Text weight="medium" className="truncate">
              {displayName}
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

      {/* Desktop: column-aligned table row */}
      <DataTableGridRow
        columns={memberColumns}
        cells={[
          <div key="member" className="flex min-w-0 items-center gap-3">
            <Avatar name={displayName} size="sm" />
            <div className="min-w-0">
              <Text weight="medium" className="truncate">
                {displayName}
              </Text>
              <Text size="xs" color="secondary" className="truncate">
                {isPending ? "Invited" : `@${member.username}`}
              </Text>
            </div>
          </div>,
          <Badge key="role" variant={member.role === "admin" ? "accent" : "neutral"}>
            {member.role === "admin" ? "Admin" : "Member"}
          </Badge>,
          <div key="status" className="flex items-center justify-end gap-2">
            {isPending ? <Badge variant="amber">Pending</Badge> : <Badge variant="success">Active</Badge>}
            {action}
          </div>,
        ]}
      />
    </>
  );
}
