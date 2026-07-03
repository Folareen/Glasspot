import { AuthCard } from "@/components/auth/AuthCard";
import { LoginForm } from "@/components/auth/LoginForm";
import { Heading } from "@/components/ui/Heading";
import { Text } from "@/components/ui/Text";

export default function LoginPage() {
  return (
    <AuthCard>
      <div className="mb-6 text-center">
        <Heading level={3}>Log in</Heading>
        <Text color="secondary" className="mt-1">
          Welcome back. Enter your details to continue.
        </Text>
      </div>
      <LoginForm />
    </AuthCard>
  );
}
