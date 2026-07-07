import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { DataTableGridRow, type DataTableColumn } from "@/components/ui/DataTable";
import { Text } from "@/components/ui/Text";
import type { InviteResponse, MemberResponse } from "@/lib/types";

export const memberColumns: DataTableColumn[] = [
  { key: "member", label: "Member", width: "2fr" },
  { key: "role", label: "Role", width: "1fr" },
  { key: "status", label: "Status", width: "1fr", align: "right" },
];

// A real pot_members row (active) or a still-pending pot_invites row — two separate backend
// resources (GET /pots/:id/members vs GET /pots/:id/invites) unified here for display, since the
// pot detail page's member list shows both together. See docs comment on
// apps/backend/src/modules/pots/pot-invites.ts for why they're split server-side.
export type MemberListRow =
  | ({ kind: "member" } & MemberResponse)
  | ({ kind: "invite" } & Pick<InviteResponse, "id" | "potId" | "email" | "role">);

type PotMemberRowProps = {
  row: MemberListRow;
  action?: React.ReactNode;
};

export function PotMemberRow({ row, action }: PotMemberRowProps) {
  const isPending = row.kind === "invite";
  const displayName = isPending ? row.email : row.fullName;

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
              {isPending ? "Invited — pending signup" : `@${row.username}`}
            </Text>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {isPending && <Badge variant="amber">Pending</Badge>}
          {row.role === "admin" && <Badge variant="accent">Admin</Badge>}
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
                {isPending ? "Invited" : `@${row.username}`}
              </Text>
            </div>
          </div>,
          <Badge key="role" variant={row.role === "admin" ? "accent" : "neutral"}>
            {row.role === "admin" ? "Admin" : "Member"}
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
