import { AuthCard } from "@/components/auth/AuthCard";
import { LoginForm } from "@/components/auth/LoginForm";
import { Heading } from "@/components/ui/Heading";
import { Text } from "@/components/ui/Text";

type LoginPageProps = {
  // Set by proxy.ts when it redirects an unauthenticated/session-expired
  // visitor here, or by apiFetch's redirectToLogin on a 401 mid-session —
  // threaded through login -> /login/verify -> OtpVerifyForm so a user
  // bounced out mid-task lands back where they were, not always /home.
  searchParams: Promise<{ redirect?: string }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const { redirect } = await searchParams;

  return (
    <AuthCard>
      <div className="mb-6 text-center">
        <Heading level={3}>Log in</Heading>
        <Text color="secondary" className="mt-1">
          Welcome back. Enter your details to continue.
        </Text>
      </div>
      <LoginForm redirectTo={redirect} />
    </AuthCard>
  );
}
