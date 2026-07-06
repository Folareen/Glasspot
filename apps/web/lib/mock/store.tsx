"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import {
  demoUser,
  initialContributions,
  initialMembers,
  initialPots,
  initialTransactions,
  registeredUsersByEmail,
} from "./fixtures";
import type {
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
  minContribution?: string;
  maxContribution?: string;
  goalAmount?: string;
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

  login: () => void;
  logout: () => void;
  setRefundProfile: (accountNumber: string, bankCode: string) => void;

  createPot: (input: CreatePotInput) => PotResponse;
  updatePot: (potId: string, patch: Partial<CreatePotInput>) => void;
  activatePot: (potId: string) => void;
  closePot: (potId: string) => void;

  contribute: (potId: string, amount: string, anonymous: boolean) => ContributionResponse;

  triggerPayout: (potId: string, destination?: { account: string; bank: string }, amount?: string) => void;
  triggerRefund: (potId: string) => void;

  addMember: (potId: string, email: string, role: PotMemberRole) => { status: "active" | "pending" };
  updateMemberRole: (potId: string, memberId: string, role: PotMemberRole) => void;
  removeMember: (potId: string, memberId: string) => void;

  getPot: (potId: string) => PotResponse | undefined;
  getMembersForPot: (potId: string) => MemberResponse[];
  getContributionsForPot: (potId: string) => ContributionResponse[];
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
        minContribution: input.minContribution ?? "100000",
        maxContribution: input.maxContribution ?? null,
        goalAmount: input.goalAmount ?? null,
        activatedAt: null,
        closedAt: null,
        createdAt: now,
        updatedAt: now,
        balance: "0",
        pendingOperation: null,
      };
      setPots((prev) => [newPot, ...prev]);
      setMembers((prev) => [
        ...prev,
        {
          id: randomId("mem"),
          potId: newPot.id,
          userId: currentUser?.id ?? demoUser.id,
          email: currentUser?.email ?? demoUser.email,
          role: "admin",
          status: "active",
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
    (potId: string, amount: string, anonymous: boolean) => {
      const now = new Date().toISOString();
      const newContribution: ContributionResponse = {
        id: randomId("con"),
        potId,
        contributorUserId: currentUser?.id ?? demoUser.id,
        virtualAccountRef: randomId("va-ref"),
        virtualAccountNumber: `98${Math.floor(10000000 + Math.random() * 89999999)}`,
        expectedAmount: amount,
        paidAmount: amount,
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
          amount: amount,
          createdAt: now,
          potId,
          potTitle: pots.find((p) => p.id === potId)?.title ?? "",
        },
        ...prev,
      ]);
      setPots((prev) =>
        prev.map((pot) =>
          pot.id === potId
            ? { ...pot, balance: String(BigInt(pot.balance) + BigInt(amount)) }
            : pot
        )
      );
      return newContribution;
    },
    [currentUser, pots]
  );

  const triggerPayout = useCallback((potId: string, destination?: { account: string; bank: string }, amount?: string) => {
    const now = new Date().toISOString();
    const pot = pots.find((p) => p.id === potId);
    const payoutAmount = amount ?? pot?.balance ?? "0";
    const remainingBalance = (BigInt(pot?.balance ?? "0") - BigInt(payoutAmount)).toString();
    setPots((prev) =>
      prev.map((p) => (p.id === potId ? { ...p, pendingOperation: "payout" } : p))
    );
    setTransactions((prev) => [
      {
        id: randomId("txn"),
        type: "payout",
        status: "processing",
        reference: randomReference(),
        externalReference: null,
        amount: payoutAmount,
        createdAt: now,
        potId,
        potTitle: pot?.title ?? "",
        destinationAccount: destination?.account,
        destinationBank: destination?.bank,
      },
      ...prev,
    ]);
    setPots((prev) =>
      prev.map((p) => (p.id === potId ? { ...p, balance: remainingBalance, pendingOperation: null } : p))
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
          amount: c.paidAmount,
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
          amount: pot?.balance ?? "0",
          createdAt: now,
          potId,
          potTitle: pot?.title ?? "",
        },
        ...prev,
      ]);
    }
    setPots((prev) =>
      prev.map((p) => (p.id === potId ? { ...p, balance: "0", pendingOperation: null } : p))
    );
  }, [pots, contributions]);

  // Mirrors PotInvitesService.create on the backend: if the invited email
  // already belongs to a known (registered) user, they join immediately as
  // an active member; otherwise a pending row is added with no userId/
  // fullName/username yet, resolved later — in the real backend, once that
  // person signs up and verifies this email (see auth.service.ts's
  // verifyEmail); here, there is no signup flow to hook into, so a pending
  // row simply stays pending in this demo.
  const addMember = useCallback((potId: string, email: string, role: PotMemberRole) => {
    const normalized = email.trim().toLowerCase();
    const existingUser = registeredUsersByEmail[normalized];

    setMembers((prev) => [
      ...prev,
      existingUser
        ? {
            id: randomId("mem"),
            potId,
            userId: existingUser.id,
            email: normalized,
            role,
            status: "active" as const,
            invitedByUserId: currentUser?.id ?? demoUser.id,
            joinedAt: new Date().toISOString(),
            fullName: existingUser.fullName,
            username: existingUser.username,
          }
        : {
            id: randomId("mem"),
            potId,
            userId: "",
            email: normalized,
            role,
            status: "pending" as const,
            invitedByUserId: currentUser?.id ?? demoUser.id,
            joinedAt: new Date().toISOString(),
            fullName: "",
            username: "",
          },
    ]);

    return { status: existingUser ? ("active" as const) : ("pending" as const) };
  }, [currentUser]);

  const updateMemberRole = useCallback((potId: string, memberId: string, role: PotMemberRole) => {
    setMembers((prev) =>
      prev.map((m) => (m.id === memberId && m.potId === potId ? { ...m, role } : m))
    );
  }, []);

  const removeMember = useCallback((potId: string, memberId: string) => {
    setMembers((prev) => prev.filter((m) => !(m.id === memberId && m.potId === potId)));
  }, []);

  const getPot = useCallback((potId: string) => pots.find((p) => p.id === potId), [pots]);
  const getMembersForPot = useCallback(
    (potId: string) => members.filter((m) => m.potId === potId),
    [members]
  );
  const getContributionsForPot = useCallback(
    (potId: string) => contributions.filter((c) => c.potId === potId),
    [contributions]
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
      getPot,
      getMembersForPot,
      getContributionsForPot,
      getTransactionsForPot,
    }),
    [
      currentUser,
      isAuthenticated,
      pots,
      members,
      contributions,
      transactions,
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
      getPot,
      getMembersForPot,
      getContributionsForPot,
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
