"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { notFound, useRouter } from "next/navigation";
import { use } from "react";
import { Check, Link2, LogOut, Pencil, Plus, RotateCcw, Send, Trash2, UserPlus } from "lucide-react";
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
import { Spinner } from "@/components/ui/Spinner";
import { Users, ReceiptText } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/lib/toast";
import { cn } from "@/lib/cn";
import {
  ApiError,
  activatePot,
  removePendingMember,
  closePot,
  getPot,
  getPendingMembers,
  getPotMembers,
  getPotTransactions,
  leavePot,
  removeMember,
} from "@/lib/api";
import { describePayoutRule } from "@/components/pot/payout-rule-copy";
import { PayoutModeIcon, payoutModeLabels } from "@/components/pot/PayoutModeIcon";
import { PotTransactionRow, activityColumns } from "@/components/pot/PotTransactionRow";
import { PotMemberRow, memberColumns, type MemberListRow } from "@/components/pot/PotMemberRow";
import { ActionRow } from "@/components/pot/ActionRow";
import { ContributeModal } from "@/components/pot/ContributeModal";
import { AwaitingPaymentModal } from "@/components/pot/AwaitingPaymentModal";
import { AddMemberModal } from "@/components/pot/AddMemberModal";
import { ConfirmActionModal } from "@/components/pot/ConfirmActionModal";
import { RefundConfirmModal } from "@/components/pot/RefundConfirmModal";
import { CloseConfirmModal } from "@/components/pot/CloseConfirmModal";
import { PayoutDestinationModal } from "@/components/pot/PayoutDestinationModal";
import { PayoutAmountModal } from "@/components/pot/PayoutAmountModal";
import { RulesTab } from "@/components/pot/RulesTab";
import type { ContributionResponse, PotResponse, TransactionType } from "@/lib/types";

const activityFilters: { id: string; label: string; types?: TransactionType[] }[] = [
  { id: "all", label: "All" },
  { id: "contribution", label: "Contributions", types: ["contribution", "funding"] },
  { id: "payout", label: "Payouts", types: ["payout"] },
  { id: "refund", label: "Refunds", types: ["refund", "reversal"] },
];

const allMemberFilters = [
  { id: "all", label: "Members" },
  { id: "pending", label: "Pending" },
  { id: "admins", label: "Admins" },
];

type PotDetailPageProps = {
  params: Promise<{ id: string }>;
};

export default function PotDetailPage({ params }: PotDetailPageProps) {
  const { id } = use(params);
  const router = useRouter();
  const { showToast } = useToast();
  const { currentUser } = useAuth();
  // Anonymous visitors reach this page directly via a shared link and have no
  // /home to go back to — see proxy.ts's isProtectedPotRoute for why this
  // route is reachable without a session at all.
  const backHref = currentUser ? "/home" : "/";

  const [pot, setPot] = useState<PotResponse | null | undefined>(undefined);
  const [memberRows, setMemberRows] = useState<MemberListRow[]>([]);
  const [transactions, setTransactions] = useState<import("@/lib/types").TransactionResponse[]>([]);

  const [contributeOpen, setContributeOpen] = useState(false);
  const [pendingContribution, setPendingContribution] = useState<ContributionResponse | null>(null);
  const [addMemberOpen, setAddMemberOpen] = useState(false);
  const [activateOpen, setActivateOpen] = useState(false);
  const [payoutOpen, setPayoutOpen] = useState(false);
  const [refundOpen, setRefundOpen] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const [removeMemberTarget, setRemoveMemberTarget] = useState<MemberListRow | null>(null);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [activityFilter, setActivityFilter] = useState("all");
  const [activityPageSize, setActivityPageSize] = useState<PageSize>(10);
  const [activityPage, setActivityPage] = useState(1);
  const [activityFullscreen, setActivityFullscreen] = useState(false);
  const [memberFilter, setMemberFilter] = useState("all");
  const [membersFullscreen, setMembersFullscreen] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);

  const isAdmin = memberRows.some(
    (m) => m.kind === "member" && m.userId === currentUser?.id && m.role === "admin"
  );

  const loadPot = useCallback(async () => {
    try {
      const data = await getPot(id);
      setPot(data);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) {
        setPot(null);
        return;
      }
      showToast(e instanceof ApiError ? e.message : "Couldn't load this pot", "error");
    }
  }, [id, showToast]);

  const loadMembers = useCallback(async () => {
    try {
      const members = await getPotMembers(id);
      const rows: MemberListRow[] = members.map((m) => ({ kind: "member" as const, ...m }));
      try {
        const pendingRows = await getPendingMembers(id);
        const pending = pendingRows
          .filter((p) => p.status === "pending")
          .map((p) => ({ kind: "pending" as const, id: p.id, potId: p.potId, email: p.email, role: p.role }));
        setMemberRows([...rows, ...pending]);
      } catch {
        // Non-admins get a 403 on GET /pots/:id/pending-members — fine, just show real members.
        setMemberRows(rows);
      }
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : "Couldn't load members", "error");
    }
  }, [id, showToast]);

  const loadTransactions = useCallback(async () => {
    try {
      setTransactions(await getPotTransactions(id));
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : "Couldn't load activity", "error");
    }
  }, [id, showToast]);

  useEffect(() => {
    // loadPot/loadMembers/loadTransactions are shared with several onConfirmed callbacks below
    // (re-fetching after a payout/refund/activate/etc succeeds), so they're real named callbacks,
    // not effect-only logic inlined here — the alternative the lint rule wants (writing the fetch
    // promise chain directly in the effect body) would mean duplicating this exact logic at every
    // call site instead of sharing it.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadPot();
    loadMembers();
    loadTransactions();
  }, [loadPot, loadMembers, loadTransactions]);

  const completedTransactions = useMemo(
    () =>
      [...transactions]
        .filter((transaction) => transaction.status === "completed")
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [transactions]
  );

  if (pot === undefined) {
    return (
      <div className="flex justify-center py-16">
        <Spinner size="md" />
      </div>
    );
  }
  if (pot === null) {
    notFound();
  }
  const currentPot: PotResponse = pot;

  const targetAmount =
    pot.payoutMode === "target_based" && pot.payoutConfig && "targetAmount" in pot.payoutConfig
      ? pot.payoutConfig.targetAmount
      : undefined;
  const progress = targetAmount
    ? Math.round((Number(pot.balance) / Number(targetAmount)) * 100)
    : null;

  // goalAmount is a display-only fundraising goal available on any payout
  // mode, distinct from target_based's payoutConfig.targetAmount (which
  // actually fires the payout) — a target_based pot can set both at once, so
  // this always renders whenever goalAmount is set, alongside (not instead
  // of) the target progress bar above. Previously this was suppressed
  // whenever a target amount was also set, which is the bug a QA tester
  // reported: the goal silently never showed on target_based pots, so only
  // the target amount was visible and got mistaken for the goal.
  const goalProgress = pot.goalAmount
    ? Math.round((Number(pot.balance) / Number(pot.goalAmount)) * 100)
    : null;

  // Only manual mode can be triggered on demand — target_based fires
  // exclusively via its own automatic rule (target date/amount reached),
  // never by an admin's discretion. See docs's payout mode split.
  const hasFixedManualDestination =
    pot.payoutMode === "manual" &&
    pot.payoutConfig &&
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
  const isCurrentMember = memberRows.some((m) => m.kind === "member" && m.userId === currentUser?.id);
  const hasActions = canTriggerPayout || canTriggerRefund || canClose || isCurrentMember;

  const activityFilterDef = activityFilters.find((filter) => filter.id === activityFilter);
  const filteredTransactions = activityFilterDef?.types
    ? completedTransactions.filter((transaction) => activityFilterDef.types!.includes(transaction.type))
    : completedTransactions;

  const pagedTransactions =
    activityPageSize === "all"
      ? filteredTransactions
      : filteredTransactions.slice((activityPage - 1) * activityPageSize, activityPage * activityPageSize);

  const filteredMembers =
    memberFilter === "pending"
      ? memberRows.filter((m) => m.kind === "pending")
      : memberFilter === "admins"
        ? memberRows.filter((m) => m.role === "admin")
        : memberRows;

  const activityExportRows = filteredTransactions.map((transaction) => [
    transaction.type,
    transaction.displayName ?? "Anonymous",
    new Date(transaction.createdAt).toISOString(),
    transaction.amount,
  ]);

  const membersExportRows = filteredMembers.map((member) => [
    member.kind === "pending" ? member.email : member.fullName,
    member.kind === "pending" ? "" : member.username,
    member.role,
    member.kind === "pending" ? "pending" : "active",
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
          exportFilename={`${currentPot.title}-activity`}
          exportHeaders={["Type", "Name", "Date", "Amount"]}
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
    const memberFilters = isAdmin ? allMemberFilters : allMemberFilters.filter((f) => f.id !== "pending");
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
          <Button size="sm" variant="secondary" onClick={() => setAddMemberOpen(true)}>
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
          exportFilename={`${currentPot.title}-members`}
          exportHeaders={["Name", "Username", "Role", "Status"]}
          exportRows={membersExportRows}
          onExpand={() => setMembersFullscreen(true)}
        />
        <DataTable
          columns={memberColumns}
          rows={filteredMembers.map((member) => (
            <PotMemberRow
              key={member.id}
              row={member}
              action={
                isAdmin && (member.kind === "pending" || member.userId !== currentUser?.id) ? (
                  <button
                    type="button"
                    onClick={() => setRemoveMemberTarget(member)}
                    className="text-xs font-medium text-text-secondary transition-colors duration-150 hover:text-error"
                  >
                    Remove
                  </button>
                ) : undefined
              }
            />
          ))}
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
      <AppHeader title={pot.title} backHref={backHref} action={editAction} />

      <Container maxWidth="2xl" className="py-6 lg:py-10">
        <PageHeading
          title={pot.title}
          backHref={backHref}
          backLabel={currentUser ? "Your pots" : "Glasspot"}
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
              <div className="flex gap-2">
                <Button className="flex-1" onClick={() => setContributeOpen(true)}>
                  <Plus className="h-4 w-4" strokeWidth={1.5} />
                  Contribute
                </Button>
                <Button
                  variant="secondary"
                  className="w-12 px-0"
                  aria-label="Copy contribution link"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(window.location.href);
                      setLinkCopied(true);
                      showToast("Link copied", "success");
                      setTimeout(() => setLinkCopied(false), 2000);
                    } catch {
                      showToast("Couldn't copy the link", "error");
                    }
                  }}
                >
                  {linkCopied ? (
                    <Check className="h-10 w-10" strokeWidth={1.5} />
                  ) : (
                    <Link2 className="h-10 w-10" strokeWidth={1.5} />
                  )}
                </Button>
              </div>
            )}
          </div>
        </Card>

        <Tabs
          variant="underline"
          tabs={[
            { id: "rules", label: "Rules" },
            { id: "activity", label: "Activity" },
            { id: "members", label: "Members" },
            ...(hasActions ? [{ id: "actions", label: "Actions" }] : []),
          ]}
        >
          {(activeTabId) => (
            <>
              {activeTabId === "rules" && <RulesTab pot={pot} />}

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
                  {isCurrentMember && (
                    <ActionRow
                      icon={<LogOut className="h-5 w-5" strokeWidth={1.5} />}
                      title="Leave pot"
                      description="You'll lose access to this pot and won't be able to contribute or see updates unless added again."
                      buttonLabel="Leave"
                      danger
                      onClick={() => setLeaveOpen(true)}
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

      <ContributeModal
        open={contributeOpen}
        onClose={() => setContributeOpen(false)}
        pot={pot}
        onContributed={(contribution) => setPendingContribution(contribution)}
      />
      <AwaitingPaymentModal
        open={pendingContribution !== null}
        onClose={() => setPendingContribution(null)}
        potId={pot.id}
        contribution={pendingContribution}
        onResolved={() => {
          showToast("Contribution received", "success");
          setPendingContribution(null);
          loadPot();
          loadTransactions();
        }}
      />
      <AddMemberModal
        open={addMemberOpen}
        onClose={() => setAddMemberOpen(false)}
        potId={pot.id}
        onAdded={loadMembers}
      />

      <ConfirmActionModal
        open={activateOpen}
        onClose={() => setActivateOpen(false)}
        onConfirm={async () => {
          try {
            await activatePot(pot.id);
            showToast("Pot is now open for contributions", "success");
            loadPot();
          } catch (e) {
            showToast(e instanceof ApiError ? e.message : "Couldn't open this pot", "error");
          }
        }}
        title="Open this pot?"
        description="Once open, the the payout and refund rules are locked in and can no longer be changed."
        confirmLabel="Open pot"
      />

      {pot.payoutMode === "manual" && !hasFixedManualDestination ? (
        <PayoutDestinationModal
          open={payoutOpen}
          onClose={() => setPayoutOpen(false)}
          potId={pot.id}
          balance={pot.balance}
          onConfirmed={() => {
            showToast("Payout triggered", "success");
            loadPot();
            loadTransactions();
          }}
        />
      ) : (
        <PayoutAmountModal
          open={payoutOpen}
          onClose={() => setPayoutOpen(false)}
          potId={pot.id}
          balance={pot.balance}
          onConfirmed={() => {
            showToast("Payout triggered", "success");
            loadPot();
            loadTransactions();
          }}
        />
      )}

      <RefundConfirmModal
        open={refundOpen}
        onClose={() => setRefundOpen(false)}
        potId={pot.id}
        onConfirmed={() => {
          showToast("Refund triggered", "success");
          loadPot();
          loadTransactions();
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
        onConfirm={async () => {
          try {
            await closePot(pot.id);
            showToast("Pot closed", "success");
            loadPot();
          } catch (e) {
            showToast(e instanceof ApiError ? e.message : "Couldn't close this pot", "error");
          }
        }}
        balance={pot.balance}
      />

      <ConfirmActionModal
        open={removeMemberTarget !== null}
        onClose={() => setRemoveMemberTarget(null)}
        onConfirm={async () => {
          if (!removeMemberTarget) return;
          try {
            if (removeMemberTarget.kind === "pending") {
              await removePendingMember(pot.id, removeMemberTarget.id);
              showToast(`${removeMemberTarget.email} removed`);
            } else {
              await removeMember(pot.id, removeMemberTarget.userId);
              showToast(`${removeMemberTarget.fullName || removeMemberTarget.email} removed`);
            }
            loadMembers();
          } catch (e) {
            showToast(e instanceof ApiError ? e.message : "Couldn't complete that action", "error");
          }
        }}
        title={removeMemberTarget?.kind === "pending" ? "Remove this pending member?" : "Remove this member?"}
        description={
          removeMemberTarget?.kind === "pending"
            ? "They won't be added to this pot when they sign up unless added again."
            : "They'll lose access to this pot and won't be able to contribute or see updates unless added again."
        }
        confirmLabel="Remove"
        danger
      />

      <ConfirmActionModal
        open={leaveOpen}
        onClose={() => setLeaveOpen(false)}
        onConfirm={async () => {
          try {
            await leavePot(pot.id);
            showToast("You left the pot", "success");
            router.push(backHref);
          } catch (e) {
            showToast(e instanceof ApiError ? e.message : "Couldn't leave this pot", "error");
          }
        }}
        title="Leave this pot?"
        description="You'll lose access to this pot and won't be able to contribute or see updates unless added again."
        confirmLabel="Leave pot"
        danger
      />
    </div>
  );
}
