"use client";

import { useState } from "react";
import { Plus, PiggyBank, Search } from "lucide-react";
import { AppHeader } from "@/components/layout/AppHeader";
import { PageHeading } from "@/components/layout/PageHeading";
import { Container } from "@/components/ui/Container";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/Input";
import { PotCard } from "@/components/pot/PotCard";
import { useMockStore } from "@/lib/mock/store";

export default function DashboardPage() {
  const { currentUser, pots, members } = useMockStore();
  const [query, setQuery] = useState("");

  const myPotIds = new Set(
    members.filter((member) => member.userId === currentUser?.id).map((member) => member.potId)
  );
  const myPots = pots.filter((pot) => myPotIds.has(pot.id));

  const statusOrder = { open: 0, draft: 1, closed: 2 };
  const sortedPots = [...myPots].sort((a, b) => statusOrder[a.status] - statusOrder[b.status]);

  const visiblePots = sortedPots.filter((pot) =>
    pot.title.toLowerCase().includes(query.trim().toLowerCase())
  );

  return (
    <>
      <AppHeader
        title="Your pots"
        action={
          <Button
            href="/pots/new"
            size="sm"
            className="h-11 w-11 rounded-full p-0"
            aria-label="Create a pot"
          >
            <Plus className="h-5 w-5" strokeWidth={1.5} />
          </Button>
        }
      />
      <div className="sticky top-16 z-20 bg-background lg:top-0">
        <Container className="pt-6 lg:pt-10">
          <PageHeading
            title="Your pots"
            className="mb-6 hidden lg:block"
            action={
              <Button href="/pots/new" size="sm">
                <Plus className="h-4 w-4" strokeWidth={1.5} />
                New pot
              </Button>
            }
          />

          {sortedPots.length > 0 && (
            <div className="relative pb-6">
              <Search
                className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-text-secondary"
                strokeWidth={1.5}
              />
              <Input
                type="search"
                placeholder="Search your pots"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="pl-11"
              />
            </div>
          )}
        </Container>
      </div>

      <Container className="pb-6 lg:pb-10">
        {sortedPots.length === 0 ? (
          <EmptyState
            icon={<PiggyBank className="h-7 w-7" strokeWidth={1.5} />}
            title="No pots yet"
            description="Create your first pot to start pooling money with people you trust."
            action={<Button href="/pots/new">Create a pot</Button>}
          />
        ) : visiblePots.length === 0 ? (
          <EmptyState
            icon={<Search className="h-7 w-7" strokeWidth={1.5} />}
            title="No pots found"
            description={`Nothing matches "${query}". Try a different search.`}
          />
        ) : (
          <div className="flex flex-col gap-3">
            {visiblePots.map((pot) => (
              <PotCard key={pot.id} pot={pot} />
            ))}
          </div>
        )}
      </Container>
    </>
  );
}
