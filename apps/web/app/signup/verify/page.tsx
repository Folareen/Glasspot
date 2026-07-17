import { AuthCard } from "@/components/auth/AuthCard";
import { OtpVerifyForm } from "@/components/auth/OtpVerifyForm";

export default function SignupVerifyPage() {
  return (
    <AuthCard>
      <OtpVerifyForm mode="signup" successMessage="Account created successfully" />
    </AuthCard>
  );
}
