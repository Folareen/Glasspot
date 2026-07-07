"use client";

import { useMemo, useState } from "react";
import { notFound, useRouter } from "next/navigation";
import { use } from "react";
import { Pencil, Plus, RotateCcw, Send, Trash2, UserPlus } from "lucide-react";
import { AppHeader } from "@/components/layout/AppHeader";
import { PageHeading } from "@/components/layout/PageHeading";
import { Container } from "@/components/ui/Container";
import { Card } from "@/components/ui/Card";
import { Text } from "@/components/ui/Text";
import { Money } from "@/components/ui/Money";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { Divider } from "@/components/ui/Divider";
import { Tabs } from "@/components/ui/Tabs";
import { EmptyState } from "@/components/ui/EmptyState";
import { DataTable } from "@/components/ui/DataTable";
import { Pagination, type PageSize } from "@/components/ui/Pagination";
import { TableToolbar } from "@/components/ui/TableToolbar";
import { TableFullscreenModal } from "@/components/ui/TableFullscreenModal";
import { Users, ReceiptText } from "lucide-react";
import { useMockStore } from "@/lib/mock/store";
import { useToast } from "@/lib/toast";
import { cn } from "@/lib/cn";
import { describePayoutRule } from "@/components/pot/payout-rule-copy";
import { PayoutModeIcon, payoutModeLabels } from "@/components/pot/PayoutModeIcon";
import { PotTransactionRow, activityColumns } from "@/components/pot/PotTransactionRow";
import { PotMemberRow, memberColumns } from "@/components/pot/PotMemberRow";
import { ActionRow } from "@/components/pot/ActionRow";
import { ContributeModal } from "@/components/pot/ContributeModal";
import { InviteMemberModal } from "@/components/pot/InviteMemberModal";
import { ConfirmActionModal } from "@/components/pot/ConfirmActionModal";
import { RefundConfirmModal } from "@/components/pot/RefundConfirmModal";
import { CloseConfirmModal } from "@/components/pot/CloseConfirmModal";
import { PayoutDestinationModal } from "@/components/pot/PayoutDestinationModal";
import { PayoutAmountModal } from "@/components/pot/PayoutAmountModal";
import type { TransactionType } from "@/lib/mock/types";

const activityFilters: { id: string; label: string; types?: TransactionType[] }[] = [
  { id: "all", label: "All" },
  { id: "contribution", label: "Contributions", types: ["contribution", "funding"] },
  { id: "payout", label: "Payouts", types: ["payout"] },
  { id: "refund", label: "Refunds", types: ["refund", "reversal"] },
];

const memberFilters = [
  { id: "all", label: "Members" },
  { id: "invites", label: "Invites" },
  { id: "admins", label: "Admins" },
];

type PotDetailPageProps = {
  params: Promise<{ id: string }>;
};

export default function PotDetailPage({ params }: PotDetailPageProps) {
  const { id } = use(params);
  const router = useRouter();
  const { showToast } = useToast();
  const {
    currentUser,
    getPot,
    getMembersForPot,
    getTransactionsForPot,
    activatePot,
    closePot,
    triggerPayout,
    triggerRefund,
    removeMember,
  } = useMockStore();

  const [contributeOpen, setContributeOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [activateOpen, setActivateOpen] = useState(false);
  const [payoutOpen, setPayoutOpen] = useState(false);
  const [refundOpen, setRefundOpen] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const [removeMemberTarget, setRemoveMemberTarget] = useState<string | null>(null);
  const [activityFilter, setActivityFilter] = useState("all");
  const [activityPageSize, setActivityPageSize] = useState<PageSize>(10);
  const [activityPage, setActivityPage] = useState(1);
  const [activityFullscreen, setActivityFullscreen] = useState(false);
  const [memberFilter, setMemberFilter] = useState("all");
  const [membersFullscreen, setMembersFullscreen] = useState(false);

  const potOrUndefined = getPot(id);
  if (!potOrUndefined) notFound();
  const pot = potOrUndefined;

  const members = getMembersForPot(id);
  const transactions = getTransactionsForPot(id);

  const isAdmin = members.some((m) => m.userId === currentUser?.id && m.role === "admin");
  const targetAmount =
    pot.payoutMode === "target_based" && "targetAmount" in pot.payoutConfig
      ? pot.payoutConfig.targetAmount
      : undefined;
  const progress = targetAmount
    ? Math.round((Number(pot.balance) / Number(targetAmount)) * 100)
    : null;

  // goalAmount is a display-only fundraising goal available on any payout
  // mode, distinct from target_based's payoutConfig.targetAmount (which
  // actually fires the payout). Only shown when there's no payout-triggering
  // target already occupying the progress bar, so the two concepts never
  // compete for the same space.
  const goalProgress =
    !targetAmount && pot.goalAmount
      ? Math.round((Number(pot.balance) / Number(pot.goalAmount)) * 100)
      : null;

  // Only manual mode can be triggered on demand — target_based fires
  // exclusively via its own automatic rule (target date/amount reached),
  // never by an admin's discretion. See docs's payout mode split.
  const hasFixedManualDestination =
    pot.payoutMode === "manual" &&
    "destinationAccount" in pot.payoutConfig &&
    Boolean(pot.payoutConfig.destinationAccount) &&
    Boolean(pot.payoutConfig.destinationBank);
  const canTriggerPayout =
    isAdmin &&
    pot.status === "open" &&
    !pot.pendingOperation &&
    Number(pot.balance) > 0 &&
    pot.payoutMode === "manual";

  const canTriggerRefund =
    isAdmin && pot.status === "open" && !pot.pendingOperation && Number(pot.balance) > 0;

  const canClose = isAdmin && pot.status === "open";
  const hasActions = canTriggerPayout || canTriggerRefund || canClose;

  const completedTransactions = useMemo(
    () =>
      [...transactions]
        .filter((transaction) => transaction.status === "completed")
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [transactions]
  );

  const activityFilterDef = activityFilters.find((filter) => filter.id === activityFilter);
  const filteredTransactions = activityFilterDef?.types
    ? completedTransactions.filter((transaction) => activityFilterDef.types!.includes(transaction.type))
    : completedTransactions;

  const pagedTransactions =
    activityPageSize === "all"
      ? filteredTransactions
      : filteredTransactions.slice((activityPage - 1) * activityPageSize, activityPage * activityPageSize);

  const filteredMembers =
    memberFilter === "invites"
      ? members.filter((member) => member.status === "pending")
      : memberFilter === "admins"
        ? members.filter((member) => member.role === "admin")
        : members;

  const activityExportRows = filteredTransactions.map((transaction) => [
    transaction.type,
    new Date(transaction.createdAt).toISOString(),
    transaction.amount,
    transaction.status,
  ]);

  const membersExportRows = filteredMembers.map((member) => [
    member.status === "pending" ? member.email : member.fullName,
    member.status === "pending" ? "" : member.username,
    member.role,
    member.status,
  ]);

  function renderActivityFilters() {
    return (
      <div className="mb-4 flex flex-wrap gap-2">
        {activityFilters.map((filter) => (
          <button
            key={filter.id}
            type="button"
            onClick={() => {
              setActivityFilter(filter.id);
              setActivityPage(1);
            }}
            className={cn(
              "h-9 rounded-full px-3.5 text-xs font-medium transition-colors duration-150",
              activityFilter === filter.id
                ? "bg-accent text-white"
                : "border border-border bg-surface text-text-secondary hover:text-text-primary"
            )}
          >
            {filter.label}
          </button>
        ))}
      </div>
    );
  }

  function renderActivityTable() {
    if (filteredTransactions.length === 0) {
      return (
        <EmptyState
          icon={<ReceiptText className="h-6 w-6" strokeWidth={1.5} />}
          title="No activity yet"
          description="Completed transactions for this pot will show up here."
        />
      );
    }

    return (
      <>
        <TableToolbar
          className="mb-4"
          pageSize={activityPageSize}
          onPageSizeChange={(size) => {
            setActivityPageSize(size);
            setActivityPage(1);
          }}
          exportFilename={`${pot.title}-activity`}
          exportHeaders={["Type", "Date", "Amount", "Status"]}
          exportRows={activityExportRows}
          onExpand={() => setActivityFullscreen(true)}
        />
        <DataTable
          columns={activityColumns}
          rows={pagedTransactions.map((transaction) => (
            <PotTransactionRow key={transaction.id} transaction={transaction} />
          ))}
        />
        <Pagination
          className="mt-4"
          pageSize={activityPageSize}
          page={activityPage}
          onPageChange={setActivityPage}
          totalItems={filteredTransactions.length}
        />
      </>
    );
  }

  function renderMembersFilters() {
    return (
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {memberFilters.map((filter) => (
            <button
              key={filter.id}
              type="button"
              onClick={() => setMemberFilter(filter.id)}
              className={cn(
                "h-9 rounded-full px-3.5 text-xs font-medium transition-colors duration-150",
                memberFilter === filter.id
                  ? "bg-accent text-white"
                  : "border border-border bg-surface text-text-secondary hover:text-text-primary"
              )}
            >
              {filter.label}
            </button>
          ))}
        </div>
        {isAdmin && (
          <Button size="sm" variant="secondary" onClick={() => setInviteOpen(true)}>
            <UserPlus className="h-4 w-4" strokeWidth={1.5} />
            Add
          </Button>
        )}
      </div>
    );
  }

  function renderMembersTable() {
    if (filteredMembers.length === 0) {
      return <EmptyState icon={<Users className="h-6 w-6" strokeWidth={1.5} />} title="No one here yet" />;
    }

    return (
      <>
        <TableToolbar
          className="mb-4"
          exportFilename={`${pot.title}-members`}
          exportHeaders={["Name", "Username", "Role", "Status"]}
          exportRows={membersExportRows}
          onExpand={() => setMembersFullscreen(true)}
        />
        <DataTable
          columns={memberColumns}
          rows={filteredMembers.map((member) => {
            const isPending = member.status === "pending";
            return (
              <PotMemberRow
                key={member.id}
                member={member}
                action={
                  isAdmin && member.userId !== currentUser?.id ? (
                    <button
                      type="button"
                      onClick={() => setRemoveMemberTarget(member.id)}
                      className="text-xs font-medium text-text-secondary transition-colors duration-150 hover:text-error"
                    >
                      {isPending ? "Cancel invite" : "Remove"}
                    </button>
                  ) : undefined
                }
              />
            );
          })}
        />
      </>
    );
  }

  const editAction =
    pot.status === "draft" && isAdmin ? (
      <button
        type="button"
        onClick={() => router.push(`/pots/${pot.id}/edit`)}
        aria-label="Edit pot"
        className="flex h-11 w-11 items-center justify-center text-text-secondary transition-colors duration-150 hover:text-text-primary"
      >
        <Pencil className="h-5 w-5" strokeWidth={1.5} />
      </button>
    ) : undefined;

  return (
    <div>
      <AppHeader title={pot.title} backHref="/dashboard" action={editAction} />

      <Container maxWidth="2xl" className="py-6 lg:py-10">
        <PageHeading
          title={pot.title}
          backHref="/dashboard"
          backLabel="Your pots"
          action={editAction}
          className="mb-6 hidden lg:block"
        />
        <Card padding="lg" className="mb-6">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2">
              <StatusBadge status={pot.status} />
              {pot.pendingOperation && <Badge variant="amber">{pot.pendingOperation} in progress</Badge>}
            </div>
            <div className="flex items-center gap-1.5 text-text-secondary">
              <PayoutModeIcon mode={pot.payoutMode} className="h-4 w-4" />
              <Text size="xs" color="secondary">
                {payoutModeLabels[pot.payoutMode]}
              </Text>
            </div>
          </div>

          <Money naira={pot.balance} size="xl" className="mt-4 font-semibold" />
          <Text size="xs" color="secondary">
            Current balance
          </Text>

          {progress !== null && (
            <div className="mt-4">
              <ProgressBar value={progress} />
              <Text size="xs" color="secondary" className="mt-1">
                {progress}% of <Money naira={targetAmount ?? "0.00"} size="xs" color="secondary" /> target
              </Text>
            </div>
          )}

          {goalProgress !== null && (
            <div className="mt-4">
              <ProgressBar value={goalProgress} tone="success" />
              <Text size="xs" color="secondary" className="mt-1">
                {goalProgress}% of <Money naira={pot.goalAmount ?? "0.00"} size="xs" color="secondary" /> goal
              </Text>
            </div>
          )}

          {pot.description && (
            <Text color="secondary" className="mt-4">
              {pot.description}
            </Text>
          )}

          <Divider className="my-4" />

          <Text size="sm">{describePayoutRule(pot)}</Text>

          <div className="mt-5 flex flex-col gap-2">
            {pot.status === "draft" && isAdmin && (
              <Button className="w-full" onClick={() => setActivateOpen(true)}>
                Open this pot
              </Button>
            )}
            {pot.status === "open" && (
              <Button className="w-full" onClick={() => setContributeOpen(true)}>
                <Plus className="h-4 w-4" strokeWidth={1.5} />
                Contribute
              </Button>
            )}
          </div>
        </Card>

        <Tabs
          variant="underline"
          tabs={[
            { id: "activity", label: "Activity" },
            { id: "members", label: "Members" },
            ...(hasActions ? [{ id: "actions", label: "Actions" }] : []),
          ]}
        >
          {(activeTabId) => (
            <>
              {activeTabId === "activity" && (
                <div>
                  {renderActivityFilters()}
                  {renderActivityTable()}
                </div>
              )}

              {activeTabId === "members" && (
                <div>
                  {renderMembersFilters()}
                  {renderMembersTable()}
                </div>
              )}

              {activeTabId === "actions" && hasActions && (
                <div className="flex flex-col gap-3">
                  {canTriggerPayout && (
                    <ActionRow
                      icon={<Send className="h-5 w-5" strokeWidth={1.5} />}
                      title="Trigger payout"
                      description={describePayoutRule(pot)}
                      buttonLabel="Send"
                      onClick={() => setPayoutOpen(true)}
                    />
                  )}
                  {!canTriggerPayout && isAdmin && pot.status === "open" && pot.payoutMode !== "manual" && (
                    <ActionRow
                      icon={<Send className="h-5 w-5" strokeWidth={1.5} />}
                      title="Payout"
                      description={`${payoutModeLabels[pot.payoutMode]} pots pay out on their own rule, not on demand. ${describePayoutRule(pot)}`}
                      disabled
                    />
                  )}
                  {canTriggerRefund && (
                    <ActionRow
                      icon={<RotateCcw className="h-5 w-5" strokeWidth={1.5} />}
                      title="Refund"
                      description={
                        pot.refundType === "contributors"
                          ? "Send the balance back to every contributor, split by what they put in."
                          : "Send the full balance to your saved refund account."
                      }
                      buttonLabel="Refund"
                      onClick={() => setRefundOpen(true)}
                    />
                  )}
                  {canClose && (
                    <ActionRow
                      icon={<Trash2 className="h-5 w-5" strokeWidth={1.5} />}
                      title="Close pot"
                      description="Stops new contributions for good. Any balance left needs a refund first."
                      buttonLabel="Close"
                      danger
                      onClick={() => setCloseOpen(true)}
                    />
                  )}
                </div>
              )}
            </>
          )}
        </Tabs>
      </Container>

      <TableFullscreenModal open={activityFullscreen} onClose={() => setActivityFullscreen(false)} title="Activity">
        {renderActivityFilters()}
        {renderActivityTable()}
      </TableFullscreenModal>

      <TableFullscreenModal open={membersFullscreen} onClose={() => setMembersFullscreen(false)} title="Members">
        {renderMembersFilters()}
        {renderMembersTable()}
      </TableFullscreenModal>

      <ContributeModal open={contributeOpen} onClose={() => setContributeOpen(false)} pot={pot} />
      <InviteMemberModal open={inviteOpen} onClose={() => setInviteOpen(false)} potId={pot.id} />

      <ConfirmActionModal
        open={activateOpen}
        onClose={() => setActivateOpen(false)}
        onConfirm={() => {
          activatePot(pot.id);
          showToast("Pot is now open for contributions", "success");
        }}
        title="Open this pot?"
        description="Once open, the the payout and refund rules are locked in and can no longer be changed."
        confirmLabel="Open pot"
      />

      {pot.payoutMode === "manual" && !hasFixedManualDestination ? (
        <PayoutDestinationModal
          open={payoutOpen}
          onClose={() => setPayoutOpen(false)}
          balance={pot.balance}
          onConfirm={(destination, amount) => {
            triggerPayout(pot.id, destination, amount);
            showToast("Payout triggered", "success");
          }}
        />
      ) : (
        <PayoutAmountModal
          open={payoutOpen}
          onClose={() => setPayoutOpen(false)}
          balance={pot.balance}
          onConfirm={(amount) => {
            triggerPayout(pot.id, undefined, amount);
            showToast("Payout triggered", "success");
          }}
        />
      )}

      <RefundConfirmModal
        open={refundOpen}
        onClose={() => setRefundOpen(false)}
        onConfirm={() => {
          triggerRefund(pot.id);
          showToast("Refund triggered", "success");
        }}
        description={
          pot.refundType === "contributors"
            ? "Every contributor gets their own money back."
            : "The full balance goes to your saved refund account."
        }
      />

      <CloseConfirmModal
        open={closeOpen}
        onClose={() => setCloseOpen(false)}
        onConfirm={() => {
          closePot(pot.id);
          showToast("Pot closed", "success");
        }}
        balance={pot.balance}
      />

      <ConfirmActionModal
        open={removeMemberTarget !== null}
        onClose={() => setRemoveMemberTarget(null)}
        onConfirm={() => {
          const member = members.find((m) => m.id === removeMemberTarget);
          if (!member) return;
          const isPending = member.status === "pending";
          removeMember(pot.id, member.id);
          showToast(
            isPending ? `Invite to ${member.email} canceled` : `${member.fullName || member.email} removed`,
            "default"
          );
        }}
        title={
          members.find((m) => m.id === removeMemberTarget)?.status === "pending"
            ? "Cancel this invite?"
            : "Remove this member?"
        }
        description={
          members.find((m) => m.id === removeMemberTarget)?.status === "pending"
            ? "They won't be able to join this pot with that invite anymore."
            : "They'll lose access to this pot and won't be able to contribute or see updates unless invited again."
        }
        confirmLabel={
          members.find((m) => m.id === removeMemberTarget)?.status === "pending" ? "Cancel invite" : "Remove member"
        }
        danger={members.find((m) => m.id === removeMemberTarget)?.status !== "pending"}
      />
    </div>
  );
}
