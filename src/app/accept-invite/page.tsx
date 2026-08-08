import { AuthShell } from "@/components/auth/auth-shell";
import { SetPasswordForm } from "@/components/auth/set-password-form";
import { acceptInviteAction } from "@/domain/authActions";

export default function AcceptInvitePage() {
  return (
    <AuthShell title="Set your password" subtitle="Welcome to Equity Flow Group">
      <SetPasswordForm action={acceptInviteAction} submitLabel="Set password & sign in" />
    </AuthShell>
  );
}
