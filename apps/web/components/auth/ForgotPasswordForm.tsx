"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { Text } from "@/components/ui/Text";
import { ApiError, forgotPassword } from "@/lib/api";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type ForgotPasswordFormErrors = {
  email?: string;
};

export function ForgotPasswordForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errors, setErrors] = useState<ForgotPasswordFormErrors>({});

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const nextErrors: ForgotPasswordFormErrors = {};
    if (!email.trim()) {
      nextErrors.email = "Enter your email address.";
    } else if (!EMAIL_PATTERN.test(email.trim())) {
      nextErrors.email = "Enter a valid email address.";
    }
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }
    setErrors({});
    setIsSubmitting(true);
    try {
      await forgotPassword({ email: email.trim() });
      router.push(`/reset-password?email=${encodeURIComponent(email.trim())}`);
    } catch (e) {
      setErrors({ email: e instanceof ApiError ? e.message : "Couldn't send a reset code" });
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
      <Field label="Email" htmlFor="email" required error={errors.email}>
        <Input
          id="email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            setErrors((prev) => ({ ...prev, email: undefined }));
          }}
          placeholder="you@example.com"
          error={Boolean(errors.email)}
        />
      </Field>
      <Button type="submit" size="lg" className="w-full" disabled={isSubmitting}>
        {isSubmitting ? <Spinner size="sm" className="text-white" /> : "Send reset code"}
      </Button>
      <Text size="sm" color="secondary" className="text-center">
        Remembered it?{" "}
        <Link href="/login" className="font-medium text-accent">
          Log in
        </Link>
      </Text>
    </form>
  );
}
