"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import {
  demoUser,
  initialComments,
  initialContributions,
  initialMembers,
  initialPots,
  initialTransactions,
} from "./fixtures";
import type {
  CommentResponse,
  ContributionResponse,
  CurrentUser,
  MemberResponse,
  PayoutConfig,
  PayoutMode,
  PotMemberRole,
  PotResponse,
  PotType,
  RefundType,
  TransactionResponse,
} from "./types";

function randomId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function randomReference() {
  return `GLP-REF-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

type CreatePotInput = {
  title: string;
  description?: string;
  potType: PotType;
  refundType: RefundType;
  minContributionKobo?: string;
  maxContributionKobo?: string;
  payoutMode: PayoutMode;
  payoutConfig: PayoutConfig;
};

type MockStoreValue = {
  currentUser: CurrentUser | null;
  isAuthenticated: boolean;
  pots: PotResponse[];
  members: MemberResponse[];
  contributions: ContributionResponse[];
  transactions: TransactionResponse[];
  comments: CommentResponse[];

  login: () => void;
  logout: () => void;
  setRefundProfile: (accountNumber: string, bankCode: string) => void;

  createPot: (input: CreatePotInput) => PotResponse;
  updatePot: (potId: string, patch: Partial<CreatePotInput>) => void;
  activatePot: (potId: string) => void;
  closePot: (potId: string) => void;

  contribute: (potId: string, amountKobo: string, anonymous: boolean) => ContributionResponse;

  triggerPayout: (potId: string, destination?: { account: string; bank: string }) => void;
  triggerRefund: (potId: string) => void;

  addMember: (potId: string, fullName: string, role: PotMemberRole) => void;
  updateMemberRole: (potId: string, memberId: string, role: PotMemberRole) => void;
  removeMember: (potId: string, memberId: string) => void;

  addComment: (potId: string, body: string) => void;

  getPot: (potId: string) => PotResponse | undefined;
  getMembersForPot: (potId: string) => MemberResponse[];
  getContributionsForPot: (potId: string) => ContributionResponse[];
  getCommentsForPot: (potId: string) => CommentResponse[];
  getTransactionsForPot: (potId: string) => TransactionResponse[];
};

const MockStoreContext = createContext<MockStoreValue | null>(null);

export function MockStoreProvider({ children }: { children: React.ReactNode }) {
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(demoUser);
  const [isAuthenticated, setIsAuthenticated] = useState(true);
  const [pots, setPots] = useState<PotResponse[]>(initialPots);
  const [members, setMembers] = useState<MemberResponse[]>(initialMembers);
  const [contributions, setContributions] = useState<ContributionResponse[]>(initialContributions);
  const [transactions, setTransactions] = useState<TransactionResponse[]>(initialTransactions);
  const [comments, setComments] = useState<CommentResponse[]>(initialComments);

  const login = useCallback(() => {
    setCurrentUser(demoUser);
    setIsAuthenticated(true);
  }, []);

  const logout = useCallback(() => {
    setIsAuthenticated(false);
  }, []);

  const setRefundProfile = useCallback((accountNumber: string, bankCode: string) => {
    setCurrentUser((user) =>
      user ? { ...user, defaultRefundAccount: accountNumber, defaultRefundBank: bankCode } : user
    );
  }, []);

  const createPot = useCallback(
    (input: CreatePotInput) => {
      const now = new Date().toISOString();
      const newPot: PotResponse = {
        id: randomId("pot"),
        creatorId: currentUser?.id ?? demoUser.id,
        title: input.title,
        description: input.description ?? null,
        potType: input.potType,
        status: "draft",
        payoutMode: input.payoutMode,
        payoutConfig: input.payoutConfig,
        refundType: input.refundType,
        shareSlug: input.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, ""),
        minContributionKobo: input.minContributionKobo ?? "100000",
        maxContributionKobo: input.maxContributionKobo ?? null,
        activatedAt: null,
        closedAt: null,
        createdAt: now,
        updatedAt: now,
        balanceKobo: "0",
        pendingOperation: null,
      };
      setPots((prev) => [newPot, ...prev]);
      setMembers((prev) => [
        ...prev,
        {
          id: randomId("mem"),
          potId: newPot.id,
          userId: currentUser?.id ?? demoUser.id,
          role: "admin",
          invitedByUserId: null,
          joinedAt: now,
          fullName: currentUser?.fullName ?? demoUser.fullName,
          username: currentUser?.username ?? demoUser.username,
        },
      ]);
      return newPot;
    },
    [currentUser]
  );

  const updatePot = useCallback((potId: string, patch: Partial<CreatePotInput>) => {
    setPots((prev) =>
      prev.map((pot) =>
        pot.id === potId
          ? {
              ...pot,
              ...patch,
              description: patch.description ?? pot.description,
              updatedAt: new Date().toISOString(),
            }
          : pot
      )
    );
  }, []);

  const activatePot = useCallback((potId: string) => {
    setPots((prev) =>
      prev.map((pot) =>
        pot.id === potId
          ? { ...pot, status: "open", activatedAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
          : pot
      )
    );
  }, []);

  const closePot = useCallback((potId: string) => {
    setPots((prev) =>
      prev.map((pot) =>
        pot.id === potId
          ? { ...pot, status: "closed", closedAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
          : pot
      )
    );
  }, []);

  const contribute = useCallback(
    (potId: string, amountKobo: string, anonymous: boolean) => {
      const now = new Date().toISOString();
      const newContribution: ContributionResponse = {
        id: randomId("con"),
        potId,
        contributorUserId: currentUser?.id ?? demoUser.id,
        virtualAccountRef: randomId("va-ref"),
        virtualAccountNumber: `98${Math.floor(10000000 + Math.random() * 89999999)}`,
        expectedAmountKobo: amountKobo,
        paidAmountKobo: amountKobo,
        status: "funded",
        anonymous,
        refundAccountNumber: currentUser?.defaultRefundAccount ?? null,
        refundAccountName: currentUser?.fullName ?? null,
        refundBank: currentUser?.defaultRefundBank ?? null,
        transactionId: randomId("txn"),
        createdAt: now,
        expiresAt: now,
        fundedAt: now,
        contributorName: currentUser?.fullName ?? demoUser.fullName,
      };
      setContributions((prev) => [newContribution, ...prev]);
      setTransactions((prev) => [
        {
          id: newContribution.transactionId as string,
          type: "contribution",
          status: "completed",
          reference: randomReference(),
          externalReference: null,
          amountKobo: amountKobo,
          createdAt: now,
          potId,
          potTitle: pots.find((p) => p.id === potId)?.title ?? "",
        },
        ...prev,
      ]);
      setPots((prev) =>
        prev.map((pot) =>
          pot.id === potId
            ? { ...pot, balanceKobo: String(BigInt(pot.balanceKobo) + BigInt(amountKobo)) }
            : pot
        )
      );
      return newContribution;
    },
    [currentUser, pots]
  );

  const triggerPayout = useCallback((potId: string, destination?: { account: string; bank: string }) => {
    const now = new Date().toISOString();
    setPots((prev) =>
      prev.map((pot) => (pot.id === potId ? { ...pot, pendingOperation: "payout" } : pot))
    );
    setTransactions((prev) => [
      {
        id: randomId("txn"),
        type: "payout",
        status: "processing",
        reference: randomReference(),
        externalReference: null,
        amountKobo: pots.find((p) => p.id === potId)?.balanceKobo ?? "0",
        createdAt: now,
        potId,
        potTitle: pots.find((p) => p.id === potId)?.title ?? "",
        destinationAccount: destination?.account,
        destinationBank: destination?.bank,
      },
      ...prev,
    ]);
    setPots((prev) =>
      prev.map((pot) => (pot.id === potId ? { ...pot, balanceKobo: "0", pendingOperation: null } : pot))
    );
  }, [pots]);

  const triggerRefund = useCallback((potId: string) => {
    const now = new Date().toISOString();
    const pot = pots.find((p) => p.id === potId);
    setPots((prev) =>
      prev.map((p) => (p.id === potId ? { ...p, pendingOperation: "refund" } : p))
    );
    if (pot?.refundType === "contributors") {
      const potContributions = contributions.filter((c) => c.potId === potId && c.status === "funded");
      setTransactions((prev) => [
        ...potContributions.map((c) => ({
          id: randomId("txn"),
          type: "refund" as const,
          status: "processing" as const,
          reference: randomReference(),
          externalReference: null,
          amountKobo: c.paidAmountKobo,
          createdAt: now,
          potId,
          potTitle: pot.title,
        })),
        ...prev,
      ]);
    } else {
      setTransactions((prev) => [
        {
          id: randomId("txn"),
          type: "refund",
          status: "processing",
          reference: randomReference(),
          externalReference: null,
          amountKobo: pot?.balanceKobo ?? "0",
          createdAt: now,
          potId,
          potTitle: pot?.title ?? "",
        },
        ...prev,
      ]);
    }
    setPots((prev) =>
      prev.map((p) => (p.id === potId ? { ...p, balanceKobo: "0", pendingOperation: null } : p))
    );
  }, [pots, contributions]);

  const addMember = useCallback((potId: string, fullName: string, role: PotMemberRole) => {
    const username = fullName.toLowerCase().replace(/\s+/g, "");
    setMembers((prev) => [
      ...prev,
      {
        id: randomId("mem"),
        potId,
        userId: randomId("user"),
        role,
        invitedByUserId: currentUser?.id ?? demoUser.id,
        joinedAt: new Date().toISOString(),
        fullName,
        username,
      },
    ]);
  }, [currentUser]);

  const updateMemberRole = useCallback((potId: string, memberId: string, role: PotMemberRole) => {
    setMembers((prev) =>
      prev.map((m) => (m.id === memberId && m.potId === potId ? { ...m, role } : m))
    );
  }, []);

  const removeMember = useCallback((potId: string, memberId: string) => {
    setMembers((prev) => prev.filter((m) => !(m.id === memberId && m.potId === potId)));
  }, []);

  const addComment = useCallback((potId: string, body: string) => {
    setComments((prev) => [
      ...prev,
      {
        id: randomId("cmt"),
        potId,
        authorUserId: currentUser?.id ?? demoUser.id,
        authorName: currentUser?.fullName ?? demoUser.fullName,
        body,
        createdAt: new Date().toISOString(),
      },
    ]);
  }, [currentUser]);

  const getPot = useCallback((potId: string) => pots.find((p) => p.id === potId), [pots]);
  const getMembersForPot = useCallback(
    (potId: string) => members.filter((m) => m.potId === potId),
    [members]
  );
  const getContributionsForPot = useCallback(
    (potId: string) => contributions.filter((c) => c.potId === potId),
    [contributions]
  );
  const getCommentsForPot = useCallback(
    (potId: string) => comments.filter((c) => c.potId === potId),
    [comments]
  );
  const getTransactionsForPot = useCallback(
    (potId: string) => transactions.filter((t) => t.potId === potId),
    [transactions]
  );

  const value = useMemo<MockStoreValue>(
    () => ({
      currentUser,
      isAuthenticated,
      pots,
      members,
      contributions,
      transactions,
      comments,
      login,
      logout,
      setRefundProfile,
      createPot,
      updatePot,
      activatePot,
      closePot,
      contribute,
      triggerPayout,
      triggerRefund,
      addMember,
      updateMemberRole,
      removeMember,
      addComment,
      getPot,
      getMembersForPot,
      getContributionsForPot,
      getCommentsForPot,
      getTransactionsForPot,
    }),
    [
      currentUser,
      isAuthenticated,
      pots,
      members,
      contributions,
      transactions,
      comments,
      login,
      logout,
      setRefundProfile,
      createPot,
      updatePot,
      activatePot,
      closePot,
      contribute,
      triggerPayout,
      triggerRefund,
      addMember,
      updateMemberRole,
      removeMember,
      addComment,
      getPot,
      getMembersForPot,
      getContributionsForPot,
      getCommentsForPot,
      getTransactionsForPot,
    ]
  );

  return <MockStoreContext.Provider value={value}>{children}</MockStoreContext.Provider>;
}

export function useMockStore() {
  const ctx = useContext(MockStoreContext);
  if (!ctx) {
    throw new Error("useMockStore must be used within a MockStoreProvider");
  }
  return ctx;
}
