import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth/auth-shell";
import { LoginForm } from "@/components/auth/login-form";
import { getOptionalUser } from "@/domain/session";

export default async function LoginPage() {
  const user = await getOptionalUser();
  if (user) redirect("/workspace");

  return (
    <AuthShell title="Sign in" subtitle="Officer & admin workspace">
      <LoginForm />
    </AuthShell>
  );
}
