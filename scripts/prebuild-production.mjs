import { spawnSync } from "node:child_process";
import process from "node:process";

const productionDeployment = process.env.VERCEL_ENV === "production";
if (!productionDeployment) process.exit(0);
if (process.env.PRODUCTION_DEPLOY_READY !== "verified-release-v2") {
  throw new Error("Production deployment is blocked until PRODUCTION_DEPLOY_READY=verified-release-v2 is set after migration, provider, backup, and UAT evidence is approved.");
}

for (const [script, args, required] of [
  ["scripts/db-migrate.mjs", [], true],
  ["scripts/provider-diagnostics.mjs", [], false],
]) {
  const result = spawnSync(process.execPath, [script, ...args], { stdio: "inherit", env: process.env });
  if (result.status === 0) continue;
  if (required) process.exit(result.status ?? 1);
  console.warn(`[prebuild] ${script} did not complete; deployment continues because provider credentials are verified from the authenticated Admin health panel.`);
}
