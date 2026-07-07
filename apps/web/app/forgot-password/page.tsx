import { AuthCard } from "@/components/auth/AuthCard";
import { ForgotPasswordForm } from "@/components/auth/ForgotPasswordForm";
import { Heading } from "@/components/ui/Heading";
import { Text } from "@/components/ui/Text";

export default function ForgotPasswordPage() {
  return (
    <AuthCard>
      <div className="mb-6 text-center">
        <Heading level={3}>Reset your password</Heading>
        <Text color="secondary" className="mt-1">
          Enter your email and we&apos;ll send you a code to reset it.
        </Text>
      </div>
      <ForgotPasswordForm />
    </AuthCard>
  );
}
