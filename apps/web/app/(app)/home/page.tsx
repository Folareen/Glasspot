"use client";

import { useEffect, useState } from "react";
import { Plus, Search, CookingPot } from "lucide-react";
import { AppHeader } from "@/components/layout/AppHeader";
import { PageHeading } from "@/components/layout/PageHeading";
import { Container } from "@/components/ui/Container";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/Input";
import { Spinner } from "@/components/ui/Spinner";
import { PotCard } from "@/components/pot/PotCard";
import { ApiError, listPots } from "@/lib/api";
import { useToast } from "@/lib/toast";
import type { PotResponse } from "@/lib/types";

const statusOrder = { open: 0, draft: 1, closed: 2 };

export default function DashboardPage() {
  const { showToast } = useToast();
  const [pots, setPots] = useState<PotResponse[] | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    listPots({ scope: "mine" })
      .then(setPots)
      .catch((e) => {
        showToast(e instanceof ApiError ? e.message : "Couldn't load your pots", "error");
        setPots([]);
      });
  }, [showToast]);

  if (pots === null) {
    return (
      <div className="flex justify-center py-16">
        <Spinner size="md" />
      </div>
    );
  }

  const sortedPots = [...pots].sort((a, b) => statusOrder[a.status] - statusOrder[b.status]);
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
            <div className="relative mb-6">
              <Search
                className="pointer-events-none absolute left-4  h-4 w-4 bg-red-50 top-1/2 -translate-y-1/2 text-text-secondary"
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
            icon={<CookingPot className="h-7 w-7" strokeWidth={1.5} />}
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
