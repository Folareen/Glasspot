"use client";

import { Plus, PiggyBank } from "lucide-react";
import { AppHeader } from "@/components/layout/AppHeader";
import { Container } from "@/components/ui/Container";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Text } from "@/components/ui/Text";
import { PotCard } from "@/components/pot/PotCard";
import { useMockStore } from "@/lib/mock/store";

export default function DashboardPage() {
  const { currentUser, pots, members } = useMockStore();

  const myPotIds = new Set(
    members.filter((member) => member.userId === currentUser?.id).map((member) => member.potId)
  );
  const myPots = pots.filter((pot) => myPotIds.has(pot.id));

  const statusOrder = { open: 0, draft: 1, closed: 2 };
  const sortedPots = [...myPots].sort((a, b) => statusOrder[a.status] - statusOrder[b.status]);

  const firstName = currentUser?.fullName.split(" ")[0] ?? "there";

  return (
    <>
      <AppHeader
        title="Dashboard"
        action={
          <Button href="/pots/new" variant="ghost" size="sm" aria-label="Create a pot">
            <Plus className="h-5 w-5" strokeWidth={1.5} />
          </Button>
        }
      />
      <Container className="py-6">
        <Text size="lg" weight="medium" className="mb-6">
          Welcome back, {firstName}
        </Text>

        {sortedPots.length === 0 ? (
          <EmptyState
            icon={<PiggyBank className="h-7 w-7" strokeWidth={1.5} />}
            title="No pots yet"
            description="Create your first pot to start pooling money with people you trust."
            action={<Button href="/pots/new">Create a pot</Button>}
          />
        ) : (
          <div className="flex flex-col gap-3">
            {sortedPots.map((pot) => (
              <PotCard key={pot.id} pot={pot} />
            ))}
          </div>
        )}
      </Container>
    </>
  );
}
