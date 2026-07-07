"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { OtpInput } from "@/components/auth/OtpInput";
import { useResendTimer } from "@/components/auth/useResendTimer";
import { Field } from "@/components/ui/Field";
import { PasswordInput } from "@/components/ui/PasswordInput";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { Text } from "@/components/ui/Text";
import { useToast } from "@/lib/toast";
import { ApiError, resendOtp, resetPassword } from "@/lib/api";

const MIN_PASSWORD_LENGTH = 8;

type ResetPasswordFormProps = {
  email: string;
};

type ResetPasswordFormErrors = {
  code?: string;
  password?: string;
  confirmPassword?: string;
};

export function ResetPasswordForm({ email }: ResetPasswordFormProps) {
  const router = useRouter();
  const { showToast } = useToast();
  const { secondsLeft, label, reset } = useResendTimer();
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errors, setErrors] = useState<ResetPasswordFormErrors>({});

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const nextErrors: ResetPasswordFormErrors = {};
    if (code.length !== 6) {
      nextErrors.code = "Enter all 6 digits.";
    }
    if (!password.trim()) {
      nextErrors.password = "Create a new password.";
    } else if (password.length < MIN_PASSWORD_LENGTH) {
      nextErrors.password = `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
    }
    if (confirmPassword !== password) {
      nextErrors.confirmPassword = "Passwords don't match.";
    }
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }
    setErrors({});
    setIsSubmitting(true);
    try {
      await resetPassword({ email, code, newPassword: password });
      showToast("Password reset. Please log in with your new password.", "success");
      router.push("/login");
    } catch (e) {
      setErrors({ code: e instanceof ApiError ? e.message : "Couldn't reset your password" });
      setIsSubmitting(false);
    }
  }

  async function handleResend() {
    if (secondsLeft > 0) return;
    try {
      await resendOtp({ email, purpose: "password_reset" });
      reset();
      showToast(`We sent a new code to ${email}. Check spam if you don't see it.`, "success");
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : "Couldn't resend the code", "error");
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <OtpInput
          value={code}
          onChange={(next) => {
            setCode(next);
            setErrors((prev) => ({ ...prev, code: undefined }));
          }}
        />
        {errors.code && (
          <Text size="xs" color="error" className="text-center">
            {errors.code}
          </Text>
        )}
      </div>

      <Field
        label="New password"
        htmlFor="password"
        required
        error={errors.password}
        helperText={errors.password ? undefined : "At least 8 characters"}
      >
        <PasswordInput
          id="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            setErrors((prev) => ({ ...prev, password: undefined }));
          }}
          placeholder="Create a new password"
          error={Boolean(errors.password)}
        />
      </Field>

      <Field label="Confirm new password" htmlFor="confirmPassword" required error={errors.confirmPassword}>
        <PasswordInput
          id="confirmPassword"
          autoComplete="new-password"
          value={confirmPassword}
          onChange={(e) => {
            setConfirmPassword(e.target.value);
            setErrors((prev) => ({ ...prev, confirmPassword: undefined }));
          }}
          placeholder="Re-enter your new password"
          error={Boolean(errors.confirmPassword)}
        />
      </Field>

      <Button type="submit" size="lg" className="w-full" disabled={isSubmitting}>
        {isSubmitting ? <Spinner size="sm" className="text-white" /> : "Reset password"}
      </Button>

      <div className="text-center">
        {secondsLeft > 0 ? (
          <Text size="sm" color="secondary">
            Resend in {label}
          </Text>
        ) : (
          <button type="button" onClick={handleResend} className="text-sm font-medium text-accent">
            Resend code
          </button>
        )}
      </div>
    </form>
  );
}
