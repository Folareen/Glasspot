"use client";

import { useState } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Textarea";
import { Text } from "@/components/ui/Text";
import { EmptyState } from "@/components/ui/EmptyState";
import { MessageCircle } from "lucide-react";
import { useMockStore } from "@/lib/mock/store";
import type { CommentResponse } from "@/lib/mock/types";

function timeAgo(iso: string) {
  return new Date(iso).toLocaleDateString("en-NG", { day: "numeric", month: "short" });
}

type CommentThreadProps = {
  potId: string;
  comments: CommentResponse[];
};

export function CommentThread({ potId, comments }: CommentThreadProps) {
  const { addComment } = useMockStore();
  const [draft, setDraft] = useState("");

  function handleSubmit() {
    const body = draft.trim();
    if (!body) return;
    addComment(potId, body);
    setDraft("");
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Say something to the group"
          rows={2}
        />
        <Button size="sm" className="self-end" onClick={handleSubmit} disabled={!draft.trim()}>
          Post
        </Button>
      </div>

      {comments.length === 0 ? (
        <EmptyState
          icon={<MessageCircle className="h-6 w-6" strokeWidth={1.5} />}
          title="No comments yet"
          description="Be the first to say something."
        />
      ) : (
        <div className="flex flex-col gap-4">
          {comments.map((comment) => (
            <div key={comment.id} className="flex gap-3">
              <Avatar name={comment.authorName} size="sm" />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <Text weight="medium" size="sm">
                    {comment.authorName}
                  </Text>
                  <Text size="xs" color="secondary">
                    {timeAgo(comment.createdAt)}
                  </Text>
                </div>
                <Text size="sm" className="mt-0.5">
                  {comment.body}
                </Text>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
