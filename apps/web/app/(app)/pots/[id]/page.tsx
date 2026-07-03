"use client";

import { useState } from "react";
import { notFound, useRouter } from "next/navigation";
import { use } from "react";
import { Pencil, Plus, UserPlus } from "lucide-react";
import { AppHeader } from "@/components/layout/AppHeader";
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
import { AvatarStack } from "@/components/ui/AvatarStack";
import { EmptyState } from "@/components/ui/EmptyState";
import { Users, ReceiptText } from "lucide-react";
import { useMockStore } from "@/lib/mock/store";
import { useToast } from "@/lib/toast";
import { describePayoutRule } from "@/components/pot/payout-rule-copy";
import { PayoutModeIcon, payoutModeLabels } from "@/components/pot/PayoutModeIcon";
import { ContributionRow } from "@/components/pot/ContributionRow";
import { MemberRow } from "@/components/pot/MemberRow";
import { CommentThread } from "@/components/pot/CommentThread";
import { ContributeModal } from "@/components/pot/ContributeModal";
import { InviteMemberModal } from "@/components/pot/InviteMemberModal";
import { ConfirmActionModal } from "@/components/pot/ConfirmActionModal";
import { PayoutDestinationModal } from "@/components/pot/PayoutDestinationModal";

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
    getContributionsForPot,
    getCommentsForPot,
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

  const pot = getPot(id);
  if (!pot) notFound();

  const members = getMembersForPot(id);
  const contributions = getContributionsForPot(id);
  const comments = getCommentsForPot(id);

  const isAdmin = members.some((m) => m.userId === currentUser?.id && m.role === "admin");
  const targetAmountKobo =
    pot.payoutMode === "target_based" && "targetAmountKobo" in pot.payoutConfig
      ? pot.payoutConfig.targetAmountKobo
      : undefined;
  const progress = targetAmountKobo
    ? Math.round((Number(pot.balanceKobo) / Number(targetAmountKobo)) * 100)
    : null;

  const canTriggerPayout =
    isAdmin &&
    pot.status === "open" &&
    !pot.pendingOperation &&
    Number(pot.balanceKobo) > 0 &&
    (pot.payoutMode === "manual" ||
      (pot.payoutMode === "target_based" &&
        "adminManualEnabled" in pot.payoutConfig &&
        pot.payoutConfig.adminManualEnabled));

  const canTriggerRefund =
    isAdmin && pot.status === "open" && !pot.pendingOperation && Number(pot.balanceKobo) > 0;

  const canClose = isAdmin && pot.status === "open" && Number(pot.balanceKobo) === 0;

  return (
    <div>
      <AppHeader
        title={pot.title}
        backHref="/dashboard"
        action={
          pot.status === "draft" && isAdmin ? (
            <button
              type="button"
              onClick={() => router.push(`/pots/${pot.id}/edit`)}
              aria-label="Edit pot"
              className="flex h-11 w-11 items-center justify-center text-text-secondary transition-colors duration-150 hover:text-text-primary"
            >
              <Pencil className="h-5 w-5" strokeWidth={1.5} />
            </button>
          ) : undefined
        }
      />

      <Container className="max-w-2xl py-6">
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

          <Money kobo={pot.balanceKobo} size="xl" className="mt-4 font-semibold" />
          <Text size="xs" color="secondary">
            Current balance
          </Text>

          {progress !== null && (
            <div className="mt-4">
              <ProgressBar value={progress} />
              <Text size="xs" color="secondary" className="mt-1">
                {progress}% of <Money kobo={targetAmountKobo ?? "0"} size="xs" color="secondary" /> target
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

          <div className="mt-5 flex flex-wrap gap-2">
            {pot.status === "draft" && isAdmin && (
              <Button className="flex-1" onClick={() => setActivateOpen(true)}>
                Open this pot
              </Button>
            )}
            {pot.status === "open" && (
              <Button className="flex-1" onClick={() => setContributeOpen(true)}>
                <Plus className="h-4 w-4" strokeWidth={1.5} />
                Contribute
              </Button>
            )}
            {canTriggerPayout && (
              <Button variant="secondary" className="flex-1" onClick={() => setPayoutOpen(true)}>
                Trigger payout
              </Button>
            )}
            {canTriggerRefund && (
              <Button variant="secondary" className="flex-1" onClick={() => setRefundOpen(true)}>
                Refund
              </Button>
            )}
            {canClose && (
              <Button variant="ghost" className="flex-1" onClick={() => setCloseOpen(true)}>
                Close pot
              </Button>
            )}
          </div>
        </Card>

        <Tabs
          tabs={[
            { id: "contributions", label: "Contributions" },
            { id: "members", label: "Members" },
            { id: "comments", label: "Comments" },
          ]}
        >
          {(activeTabId) => (
            <>
              {activeTabId === "contributions" && (
                <div>
                  {contributions.length === 0 ? (
                    <EmptyState
                      icon={<ReceiptText className="h-6 w-6" strokeWidth={1.5} />}
                      title="No contributions yet"
                      description="Contributions to this pot will show up here."
                    />
                  ) : (
                    <Card padding="md" className="divide-y divide-border">
                      {contributions.map((contribution) => (
                        <ContributionRow key={contribution.id} contribution={contribution} />
                      ))}
                    </Card>
                  )}
                </div>
              )}

              {activeTabId === "members" && (
                <div>
                  <div className="mb-3 flex items-center justify-between">
                    <AvatarStack names={members.slice(0, 5).map((m) => m.fullName)} extraCount={Math.max(0, members.length - 5)} />
                    {isAdmin && (
                      <Button size="sm" variant="secondary" onClick={() => setInviteOpen(true)}>
                        <UserPlus className="h-4 w-4" strokeWidth={1.5} />
                        Add
                      </Button>
                    )}
                  </div>
                  {members.length === 0 ? (
                    <EmptyState icon={<Users className="h-6 w-6" strokeWidth={1.5} />} title="No members yet" />
                  ) : (
                    <Card padding="md" className="divide-y divide-border">
                      {members.map((member) => (
                        <MemberRow
                          key={member.id}
                          member={member}
                          action={
                            isAdmin && member.userId !== currentUser?.id ? (
                              <button
                                type="button"
                                onClick={() => {
                                  removeMember(pot.id, member.id);
                                  showToast(`${member.fullName} removed`, "default");
                                }}
                                className="text-xs font-medium text-text-secondary transition-colors duration-150 hover:text-error"
                              >
                                Remove
                              </button>
                            ) : undefined
                          }
                        />
                      ))}
                    </Card>
                  )}
                </div>
              )}

              {activeTabId === "comments" && <CommentThread potId={pot.id} comments={comments} />}
            </>
          )}
        </Tabs>
      </Container>

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
        description="Once open, the payout rule is locked in and can no longer be changed."
        confirmLabel="Open pot"
      />

      {pot.payoutMode === "manual" ? (
        <PayoutDestinationModal
          open={payoutOpen}
          onClose={() => setPayoutOpen(false)}
          onConfirm={(destination) => {
            triggerPayout(pot.id, destination);
            showToast("Payout triggered", "success");
          }}
        />
      ) : (
        <ConfirmActionModal
          open={payoutOpen}
          onClose={() => setPayoutOpen(false)}
          onConfirm={() => {
            triggerPayout(pot.id);
            showToast("Payout triggered", "success");
          }}
          title="Trigger payout?"
          description="This releases the full balance to the payout account. This cannot be undone."
          confirmLabel="Trigger payout"
        />
      )}

      <ConfirmActionModal
        open={refundOpen}
        onClose={() => setRefundOpen(false)}
        onConfirm={() => {
          triggerRefund(pot.id);
          showToast("Refund triggered", "success");
        }}
        title="Refund this pot?"
        description={
          pot.refundType === "contributors"
            ? "Every contributor gets their own money back."
            : "The full balance goes to your saved refund account."
        }
        confirmLabel="Trigger refund"
      />

      <ConfirmActionModal
        open={closeOpen}
        onClose={() => setCloseOpen(false)}
        onConfirm={() => {
          closePot(pot.id);
          showToast("Pot closed", "success");
        }}
        title="Close this pot?"
        description="Closing a pot is final. You can only close a pot once its balance is zero."
        confirmLabel="Close pot"
      />
    </div>
  );
}
