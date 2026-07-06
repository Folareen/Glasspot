import { AuthCard } from "@/components/auth/AuthCard";
import { OtpVerifyForm } from "@/components/auth/OtpVerifyForm";
import { Heading } from "@/components/ui/Heading";
import { Text } from "@/components/ui/Text";

type SignupVerifyPageProps = {
  searchParams: Promise<{ email?: string }>;
};

export default async function SignupVerifyPage({ searchParams }: SignupVerifyPageProps) {
  const { email = "" } = await searchParams;

  return (
    <AuthCard>
      <div className="mb-6 text-center">
        <Heading level={3}>Verify your email</Heading>
        <Text color="secondary" className="mt-1">
          Enter the code we sent to {email || "your email"} to finish setting up your account.
        </Text>
        <Text size="sm" color="secondary" className="mt-2">
          Can&apos;t find it? Check your spam or junk folder.
        </Text>
      </div>
      <OtpVerifyForm email={email} successMessage="Account created successfully" />
    </AuthCard>
  );
}
