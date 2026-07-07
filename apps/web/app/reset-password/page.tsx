import { AuthCard } from "@/components/auth/AuthCard";
import { ResetPasswordForm } from "@/components/auth/ResetPasswordForm";
import { Heading } from "@/components/ui/Heading";
import { Text } from "@/components/ui/Text";

type ResetPasswordPageProps = {
  searchParams: Promise<{ email?: string }>;
};

export default async function ResetPasswordPage({ searchParams }: ResetPasswordPageProps) {
  const { email = "" } = await searchParams;

  return (
    <AuthCard>
      <div className="mb-6 text-center">
        <Heading level={3}>Enter your code</Heading>
        <Text color="secondary" className="mt-1">
          Enter the code we sent to {email || "your email"}, then set a new password.
        </Text>
        <Text size="sm" color="secondary" className="mt-2">
          Can&apos;t find it? Check your spam or junk folder.
        </Text>
      </div>
      <ResetPasswordForm email={email} />
    </AuthCard>
  );
}
