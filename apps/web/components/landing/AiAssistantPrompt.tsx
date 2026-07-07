"use client";

import { useState } from "react";
import { Sparkles } from "lucide-react";
import { Container } from "@/components/ui/Container";
import { Card } from "@/components/ui/Card";
import { Heading } from "@/components/ui/Heading";
import { Text } from "@/components/ui/Text";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";

export function AiAssistantPrompt() {
  const [prompt, setPrompt] = useState("");
  const [reply, setReply] = useState("");

  function handleAsk() {
    if (!prompt.trim()) return;
    setReply("Coming soon, after we win the hackathon.");
  }

  return (
    <Container className="mt-10">
      <Card padding="lg" tone="accent" className="flex flex-col items-center gap-3 text-center">
        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-accent text-white">
          <Sparkles className="h-5 w-5" strokeWidth={1.5} />
        </span>
        <Heading level={3}>Didn&apos;t see your use case?</Heading>
        <Text color="secondary" className="max-w-md">
          Describe what you&apos;re trying to set up in plain words, and let the assistant build it
          out for you.
        </Text>
        <div className="mt-2 flex w-full max-w-md flex-col gap-2 sm:flex-row">
          <Input
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="e.g. Split rent with 3 roommates every month"
            className="flex-1"
          />
          <Button type="button" onClick={handleAsk}>
            Ask the assistant
          </Button>
        </div>
        {reply && (
          <Text size="sm" color="secondary">
            {reply}
          </Text>
        )}
      </Card>
    </Container>
  );
}
