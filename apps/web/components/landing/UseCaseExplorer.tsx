"use client";

import { useState } from "react";
import { Container } from "@/components/ui/Container";
import { Heading } from "@/components/ui/Heading";
import { Text } from "@/components/ui/Text";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Tabs } from "@/components/ui/Tabs";
import { Sparkles } from "lucide-react";
import { TryItModal } from "./TryItModal";
import { AiAssistantPrompt } from "./AiAssistantPrompt";
import {
  useCasesByMode,
  payoutModeMeta,
  potTypeBadge,
  refundTypeBadge,
  type MvpPayoutMode,
  type UseCase,
} from "./use-cases-data";

const tabs = (Object.keys(payoutModeMeta) as MvpPayoutMode[]).map((mode) => ({
  id: mode,
  label: payoutModeMeta[mode].label,
}));

export function UseCaseExplorer() {
  const [tryItUseCase, setTryItUseCase] = useState<UseCase | null>(null);

  return (
    <section className="border-t border-border py-16 sm:py-24">
      <Container>
        <Heading level={2} font="display" className="max-w-xl">
          More ways it fits, by how the payout works
        </Heading>
        <Text size="lg" color="secondary" className="mt-4 max-w-xl">
          Every pot picks one payout engine at setup. Explore the other situations each one covers.
        </Text>
        <div className="mt-8">
          <Tabs tabs={tabs}>
            {(activeTabId) => {
              const mode = activeTabId as MvpPayoutMode;
              return (
                <>
                  <Text color="secondary" className="mb-6 max-w-xl">
                    {payoutModeMeta[mode].description}
                  </Text>
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {useCasesByMode[mode].map((useCase) => (
                      <Card key={useCase.id} padding="md" className="flex flex-col">
                        <Heading level={4}>{useCase.title}</Heading>
                        <Text size="sm" color="secondary" className="mt-2">
                          {useCase.description}
                        </Text>
                        <div className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-2.5">
                          <Badge variant="accent">{payoutModeMeta[useCase.payoutMode].label}</Badge>
                          <Badge>{potTypeBadge[useCase.potType]}</Badge>
                          <Badge>{refundTypeBadge[useCase.refundType]}</Badge>
                        </div>
                        <Button
                          type="button"
                          size="sm"
                          className="mt-6 w-full"
                          onClick={() => setTryItUseCase(useCase)}
                        >
                          <Sparkles className="h-4 w-4" strokeWidth={1.5} />
                          Try it
                        </Button>
                      </Card>
                    ))}
                  </div>
                </>
              );
            }}
          </Tabs>
        </div>
      </Container>

      <AiAssistantPrompt />

      <TryItModal open={tryItUseCase !== null} onClose={() => setTryItUseCase(null)} useCase={tryItUseCase} />
    </section>
  );
}
