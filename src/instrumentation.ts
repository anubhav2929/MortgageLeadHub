// Runs once when the server starts (Next.js instrumentation hook — see
// https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation).
// Used for exactly the two things that need to happen once at boot, not on
// every request: announcing which adapters are actually live, and refusing
// to boot in production with a configuration that would silently lose data.

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { announceCapabilitiesOnce } = await import("@/lib/env");
  announceCapabilitiesOnce();

  const isProduction = process.env.VERCEL_ENV === "production" || process.env.NODE_ENV === "production";
  if (isProduction && !process.env.DATABASE_URL) {
    throw new Error(
      "[MortgageLeadHub] Refusing to start in production without DATABASE_URL — without it, every cold start resets to seed data and concurrent instances won't share leads. Provision Vercel Postgres/Neon and set DATABASE_URL. See DEPLOY.md."
    );
  }
}
