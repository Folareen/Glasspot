import { AuthCard } from "@/components/auth/AuthCard";
import { OtpVerifyForm } from "@/components/auth/OtpVerifyForm";

type LoginVerifyPageProps = {
  searchParams: Promise<{ redirect?: string }>;
};

export default async function LoginVerifyPage({ searchParams }: LoginVerifyPageProps) {
  const { redirect } = await searchParams;

  return (
    <AuthCard>
      <OtpVerifyForm mode="login" successMessage="Logged in successfully" redirectTo={redirect} />
    </AuthCard>
  );
}
