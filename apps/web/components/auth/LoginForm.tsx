"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { PasswordInput } from "@/components/ui/PasswordInput";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { Text } from "@/components/ui/Text";
import { ApiError, login, resendOtp } from "@/lib/api";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type LoginFormErrors = {
  email?: string;
  password?: string;
};

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errors, setErrors] = useState<LoginFormErrors>({});

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const nextErrors: LoginFormErrors = {};
    if (!email.trim()) {
      nextErrors.email = "Enter your email address.";
    } else if (!EMAIL_PATTERN.test(email.trim())) {
      nextErrors.email = "Enter a valid email address.";
    }
    if (!password.trim()) {
      nextErrors.password = "Enter your password.";
    }
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }
    setErrors({});
    setIsSubmitting(true);
    try {
      await login({ email: email.trim(), password });
      router.push(`/login/verify?email=${encodeURIComponent(email.trim())}`);
    } catch (e) {
      // AuthService.login rejects with 403 specifically (and only) when the account exists,
      // the password is correct, but the email was never verified after signup — the account has
      // no way to get a fresh code otherwise, since it never reached the OTP step the first time.
      // Resend the signup-verification code here and drop them at the same verify screen a fresh
      // signup would, rather than stranding them on a "couldn't log in" error with no way forward.
      if (e instanceof ApiError && e.status === 403) {
        try {
          await resendOtp({ email: email.trim(), purpose: "signup_verification" });
        } catch {
          // Best-effort — verify page's own "Resend code" still works if this one failed.
        }
        router.push(`/signup/verify?email=${encodeURIComponent(email.trim())}`);
        return;
      }
      setErrors({ password: e instanceof ApiError ? e.message : "Couldn't log you in" });
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
      <Field label="Password" htmlFor="password" required error={errors.password}>
        <PasswordInput
          id="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            setErrors((prev) => ({ ...prev, password: undefined }));
          }}
          placeholder="Enter your password"
          error={Boolean(errors.password)}
        />
      </Field>
      <Link href="/forgot-password" className="-mt-3 self-end text-sm font-medium text-accent">
        Forgot password?
      </Link>
      <Button type="submit" size="lg" className="w-full" disabled={isSubmitting}>
        {isSubmitting ? <Spinner size="sm" className="text-white" /> : "Log in"}
      </Button>
      <Text size="sm" color="secondary" className="text-center">
        Don&apos;t have an account?{" "}
        <Link href="/signup" className="font-medium text-accent">
          Sign up
        </Link>
      </Text>
    </form>
  );
}
