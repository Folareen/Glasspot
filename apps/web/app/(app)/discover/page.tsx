"use client";

import { useEffect, useState } from "react";
import { Compass, Search } from "lucide-react";
import { AppHeader } from "@/components/layout/AppHeader";
import { PageHeading } from "@/components/layout/PageHeading";
import { Container } from "@/components/ui/Container";
import { Input } from "@/components/ui/Input";
import { EmptyState } from "@/components/ui/EmptyState";
import { Spinner } from "@/components/ui/Spinner";
import { PotCard } from "@/components/pot/PotCard";
import { ApiError, listPots } from "@/lib/api";
import { useToast } from "@/lib/toast";
import type { PotResponse } from "@/lib/types";

export default function DiscoverPage() {
  const { showToast } = useToast();
  const [pots, setPots] = useState<PotResponse[] | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    const query = search.trim();
    const timeout = setTimeout(() => {
      listPots({ scope: "public", q: query || undefined })
        .then(setPots)
        .catch((e) => {
          showToast(e instanceof ApiError ? e.message : "Couldn't load public pots", "error");
          setPots([]);
        });
    }, 250);
    return () => clearTimeout(timeout);
  }, [search, showToast]);

  return (
    <>
      <AppHeader title="Explore" />
      <Container className="py-6 lg:py-10">
        <PageHeading title="Explore" className="mb-6 hidden lg:block" />

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

        {pots === null ? (
          <div className="flex justify-center py-16">
            <Spinner size="md" />
          </div>
        ) : pots.length === 0 ? (
          <EmptyState
            icon={<Compass className="h-7 w-7" strokeWidth={1.5} />}
            title="No pots found"
            description={search ? "Try a different search." : "No public pots yet."}
          />
        ) : (
          <div className="flex flex-col gap-3">
            {pots.map((pot) => (
              <PotCard key={pot.id} pot={pot} />
            ))}
          </div>
        )}
      </Container>
    </>
  );
}
