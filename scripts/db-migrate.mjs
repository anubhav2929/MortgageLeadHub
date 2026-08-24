import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import pg from "pg";

try {
  process.loadEnvFile(".env.local");
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

const databaseUrl = process.env.DIRECT_URL || process.env.DATABASE_URL || process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");
const apply = process.argv.includes("--apply");
const url = new URL(databaseUrl);
const isSupabase = url.hostname.endsWith(".supabase.com");
const supabaseCa = process.env.SUPABASE_CA_CERT?.replace(/\\n/g, "\n");
const databaseCa = process.env.DATABASE_CA_CERT?.replace(/\\n/g, "\n");
if (isSupabase && !supabaseCa) throw new Error("SUPABASE_CA_CERT is required for verified Supabase TLS");
url.searchParams.delete("sslmode");
const client = new pg.Client({ connectionString: url.toString(), ssl: { ...(isSupabase ? { ca: supabaseCa } : databaseCa ? { ca: databaseCa } : {}), rejectUnauthorized: true } });
await client.connect();
try {
  const directory = path.join(process.cwd(), "migrations");
  const files = (await fs.readdir(directory)).filter((file) => file.endsWith(".sql")).sort();
  const migrationTableExists = Boolean((await client.query("SELECT to_regclass('public.schema_migrations') AS name")).rows[0]?.name);
  const applied = new Set(
    migrationTableExists
      ? (await client.query("SELECT version FROM schema_migrations")).rows.map((row) => row.version)
      : []
  );
  const pending = files.filter((file) => !applied.has(path.basename(file, ".sql")));
  console.log(JSON.stringify({ apply, migrationTableExists, applied: [...applied], pending }, null, 2));
  if (!apply || pending.length === 0) process.exitCode = pending.length > 0 ? 2 : 0;
  if (apply) {
    for (const file of pending) {
      const sql = await fs.readFile(path.join(directory, file), "utf8");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (version) VALUES ($1) ON CONFLICT (version) DO NOTHING", [path.basename(file, ".sql")]);
      console.log(`Applied ${file}`);
    }
  }
} finally {
  await client.end();
}
