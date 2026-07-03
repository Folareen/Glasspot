"use client";

import { useState } from "react";
import { Compass, Search } from "lucide-react";
import { AppHeader } from "@/components/layout/AppHeader";
import { Container } from "@/components/ui/Container";
import { Input } from "@/components/ui/Input";
import { EmptyState } from "@/components/ui/EmptyState";
import { PotCard } from "@/components/pot/PotCard";
import { useMockStore } from "@/lib/mock/store";

export default function DiscoverPage() {
  const { pots } = useMockStore();
  const [search, setSearch] = useState("");

  const publicPots = pots.filter((pot) => pot.potType === "public");
  const query = search.trim().toLowerCase();
  const results = query
    ? publicPots.filter((pot) => pot.title.toLowerCase().includes(query))
    : publicPots;

  return (
    <>
      <AppHeader title="Discover" />
      <Container className="py-6">
        <div className="relative mb-6">
          <Search
            className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-text-secondary"
            strokeWidth={1.5}
          />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search public pots"
            className="pl-11"
            aria-label="Search public pots"
          />
        </div>

        {results.length === 0 ? (
          <EmptyState
            icon={<Compass className="h-7 w-7" strokeWidth={1.5} />}
            title="No pots found"
            description={query ? "Try a different search." : "No public pots yet."}
          />
        ) : (
          <div className="flex flex-col gap-3">
            {results.map((pot) => (
              <PotCard key={pot.id} pot={pot} />
            ))}
          </div>
        )}
      </Container>
    </>
  );
}
