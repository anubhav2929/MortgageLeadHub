import { AuthShell } from "@/components/auth/auth-shell";
import { SetPasswordForm } from "@/components/auth/set-password-form";
import { resetPasswordAction } from "@/domain/authActions";

export default function ResetPasswordPage() {
  return (
    <AuthShell title="Choose a new password" subtitle="Officer & admin workspace">
      <SetPasswordForm action={resetPasswordAction} submitLabel="Reset password & sign in" />
    </AuthShell>
  );
}
