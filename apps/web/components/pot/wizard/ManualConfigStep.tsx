import { Text } from "@/components/ui/Text";
import { Card } from "@/components/ui/Card";

export function ManualConfigStep() {
  return (
    <Card padding="md">
      <Text size="sm" color="secondary">
        Any admin can send the full balance to any account, whenever they choose, as many times
        as needed. The account is picked at the moment of payout, not now, and every payout stays
        visible to everyone in the pot afterward.
      </Text>
    </Card>
  );
}
