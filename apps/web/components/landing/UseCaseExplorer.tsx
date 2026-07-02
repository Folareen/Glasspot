"use client";

import { Container } from "@/components/ui/Container";
import { Heading } from "@/components/ui/Heading";
import { Text } from "@/components/ui/Text";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Tabs } from "@/components/ui/Tabs";
import {
  useCasesByMode,
  payoutModeMeta,
  potTypeBadge,
  refundTypeBadge,
  type MvpPayoutMode,
} from "./use-cases-data";

const tabs = (Object.keys(payoutModeMeta) as MvpPayoutMode[]).map((mode) => ({
  id: mode,
  label: payoutModeMeta[mode].label,
}));

export function UseCaseExplorer() {
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
                      <Card key={useCase.id} padding="md" className="flex flex-col gap-3">
                        <Heading level={4}>{useCase.title}</Heading>
                        <Text size="sm" color="secondary">
                          {useCase.description}
                        </Text>
                        <div className="mt-auto flex flex-wrap gap-2 pt-1">
                          <Badge variant="accent">{payoutModeMeta[useCase.payoutMode].label}</Badge>
                          <Badge>{potTypeBadge[useCase.potType]}</Badge>
                          <Badge>{refundTypeBadge[useCase.refundType]}</Badge>
                        </div>
                      </Card>
                    ))}
                  </div>
                </>
              );
            }}
          </Tabs>
        </div>
      </Container>
    </section>
  );
}
