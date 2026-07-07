import { Container } from "@/components/ui/Container";
import { Heading } from "@/components/ui/Heading";
import { Text } from "@/components/ui/Text";
import { Accordion } from "@/components/ui/Accordion";
import { Badge } from "@/components/ui/Badge";
import { ShieldCheck } from "lucide-react";

const faqs = [
  {
    question: "Is my money safe with Glasspot?",
    answer:
      "Every contribution moves through Nomba, a licensed Nigerian payment infrastructure provider used by over 600,000 businesses for transfers, virtual accounts, and settlement. Glasspot never holds your money in a personal account. It moves on regulated payment rails, in and out, only by the rule your group set.",
  },
  {
    question: "Who actually controls the money while it's in the pot?",
    answer:
      "Nobody, personally. Contributions sit in the pot itself, not in anyone's bank account. Money only moves out when the rule the group agreed on is met, or when a trusted admin acts, and that action is visible to everyone in the pot.",
  },
  {
    question: "Can I see the rule before I contribute?",
    answer:
      "Yes. The payout rule, the refund rule, who's involved, and the running total are all visible on the pot before you pay a single kobo in. You're never contributing blind.",
  },
  {
    question: "What happens if a pot doesn't hit its target?",
    answer:
      "It depends on the refund rule chosen when the pot was created, and that rule locks the moment the pot goes live, same as the payout rule. If a pot is set to refund contributors, every contributor gets their own contribution back automatically, and it can never be redirected to an admin instead. If it's set to admin refund, a trusted admin handles it, visible to the whole group. Either way, the pot closes clean.",
  },
  {
    question: "Can the rule be changed after people start contributing?",
    answer:
      "No. Once a pot goes live, its payout rule and refund rule lock for good. Not even the creator can quietly change them after that. That's the whole point.",
  },
  {
    question: "How do I actually pay into a pot?",
    answer:
      "By bank transfer. Every contribution gets its own one time virtual account, so your payment is easy to trace and gets matched automatically. No screenshots, no \"please confirm you got it\" messages.",
  },
  {
    question: "Is Glasspot only for private groups, or can anyone contribute?",
    answer:
      "Both work. A pot can be private, so only people who've been added can see or pay into it, or public, so anyone with the link can contribute. The creator decides which, when the pot is set up.",
  },
  {
    question: "Can I use Glasspot just for myself, not a group?",
    answer:
      "Yes. Glasspot also works for personal money separation, keep a savings target or project budget in its own pot without opening a new bank account.",
  },
];

export function FAQSection() {
  return (
    <section id="faq" className="border-t border-border bg-indigo-soft py-16 sm:py-24">
      <Container maxWidth="2xl">
        <Heading level={2} font="display">
          Questions people actually ask
        </Heading>
        <Text size="lg" color="secondary" className="mt-4">
          The questions most people ask before they trust a pot with real money.
        </Text>
        <div className="mt-8">
          <Accordion items={faqs} />
        </div>
        <div className="mt-8">
          <Badge variant="accent">
            <ShieldCheck className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
            Payments powered by Nomba, a licensed Nigerian payment infrastructure provider
          </Badge>
        </div>
      </Container>
    </section>
  );
}
