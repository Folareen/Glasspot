import { AuthCard } from "@/components/auth/AuthCard";
import { OtpVerifyForm } from "@/components/auth/OtpVerifyForm";
import { Heading } from "@/components/ui/Heading";
import { Text } from "@/components/ui/Text";

type LoginVerifyPageProps = {
  searchParams: Promise<{ email?: string }>;
};

export default async function LoginVerifyPage({ searchParams }: LoginVerifyPageProps) {
  const { email = "" } = await searchParams;

  return (
    <AuthCard>
      <div className="mb-6 text-center">
        <Heading level={3}>Enter your code</Heading>
        <Text color="secondary" className="mt-1">
          Enter the code we sent to {email || "your email"}.
        </Text>
      </div>
      <OtpVerifyForm email={email} successMessage="Logged in successfully" />
    </AuthCard>
  );
}
