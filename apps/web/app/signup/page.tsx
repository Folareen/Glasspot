import { AuthCard } from "@/components/auth/AuthCard";
import { SignupForm } from "@/components/auth/SignupForm";
import { Heading } from "@/components/ui/Heading";
import { Text } from "@/components/ui/Text";

export default function SignupPage() {
  return (
    <AuthCard>
      <div className="mb-6 text-center">
        <Heading level={3}>Create your account</Heading>
        <Text color="secondary" className="mt-1">
          Set up your account to start or join a pot.
        </Text>
      </div>
      <SignupForm />
    </AuthCard>
  );
}
