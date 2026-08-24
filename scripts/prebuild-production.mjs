import { spawnSync } from "node:child_process";
import process from "node:process";

const productionDeployment = process.env.VERCEL_ENV === "production";
if (!productionDeployment) process.exit(0);
if (process.env.PRODUCTION_DEPLOY_READY !== "verified-release-v2") {
  throw new Error("Production deployment is blocked until PRODUCTION_DEPLOY_READY=verified-release-v2 is set after migration, provider, backup, and UAT evidence is approved.");
}

for (const [script, args] of [
  ["scripts/db-migrate.mjs", []],
  ["scripts/provider-diagnostics.mjs", []],
]) {
  const result = spawnSync(process.execPath, [script, ...args], { stdio: "inherit", env: process.env });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
