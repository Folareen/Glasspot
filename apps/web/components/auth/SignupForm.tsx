"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { Text } from "@/components/ui/Text";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;

type SignupFormErrors = {
  fullName?: string;
  username?: string;
  email?: string;
  password?: string;
};

export function SignupForm() {
  const router = useRouter();
  const [fullName, setFullName] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errors, setErrors] = useState<SignupFormErrors>({});

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const nextErrors: SignupFormErrors = {};
    if (!fullName.trim()) {
      nextErrors.fullName = "Enter your full name.";
    }
    if (!username.trim()) {
      nextErrors.username = "Choose a username.";
    } else if (/\s/.test(username.trim())) {
      nextErrors.username = "Usernames can't contain spaces.";
    }
    if (!email.trim()) {
      nextErrors.email = "Enter your email address.";
    } else if (!EMAIL_PATTERN.test(email.trim())) {
      nextErrors.email = "Enter a valid email address.";
    }
    if (!password.trim()) {
      nextErrors.password = "Create a password.";
    } else if (password.length < MIN_PASSWORD_LENGTH) {
      nextErrors.password = `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
    }
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }
    setErrors({});
    setIsSubmitting(true);
    setTimeout(() => {
      router.push(`/signup/verify?email=${encodeURIComponent(email.trim())}`);
    }, 600);
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
      <Field label="Full name" htmlFor="fullName" required error={errors.fullName}>
        <Input
          id="fullName"
          type="text"
          autoComplete="name"
          value={fullName}
          onChange={(e) => {
            setFullName(e.target.value);
            setErrors((prev) => ({ ...prev, fullName: undefined }));
          }}
          placeholder="Your full name"
          error={Boolean(errors.fullName)}
        />
      </Field>
      <Field label="Username" htmlFor="username" required error={errors.username}>
        <Input
          id="username"
          type="text"
          autoComplete="username"
          value={username}
          onChange={(e) => {
            setUsername(e.target.value);
            setErrors((prev) => ({ ...prev, username: undefined }));
          }}
          placeholder="Choose a username"
          error={Boolean(errors.username)}
        />
      </Field>
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
      <Field
        label="Password"
        htmlFor="password"
        required
        error={errors.password}
        helperText={errors.password ? undefined : "At least 8 characters"}
      >
        <Input
          id="password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            setErrors((prev) => ({ ...prev, password: undefined }));
          }}
          placeholder="Create a password"
          error={Boolean(errors.password)}
        />
      </Field>
      <Field label="Phone (optional)" htmlFor="phone">
        <Input
          id="phone"
          type="tel"
          autoComplete="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="080 123 4567"
        />
      </Field>
      <Button type="submit" size="lg" className="w-full" disabled={isSubmitting}>
        {isSubmitting ? <Spinner size="sm" className="text-white" /> : "Create account"}
      </Button>
      <Text size="sm" color="secondary" className="text-center">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-accent">
          Log in
        </Link>
      </Text>
    </form>
  );
}
