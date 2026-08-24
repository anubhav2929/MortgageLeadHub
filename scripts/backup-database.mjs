import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import pg from "pg";

try {
  process.loadEnvFile(".env.local");
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

const MAGIC = Buffer.from("MLHBACKUP1\n", "utf8");
const secret = process.env.CREDENTIAL_SECRET;
if (!secret || secret.length < 16) throw new Error("CREDENTIAL_SECRET must contain at least 16 characters before creating or verifying a backup; use a generated 32-byte value for new installations");

function keyFor(salt) {
  return scryptSync(secret, salt, 32);
}

async function verify(file) {
  if (!file) throw new Error("Pass the encrypted backup path after --verify");
  const payload = await fs.readFile(path.resolve(file));
  if (!payload.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error("Backup header is invalid");
  const salt = payload.subarray(MAGIC.length, MAGIC.length + 16);
  const iv = payload.subarray(MAGIC.length + 16, MAGIC.length + 28);
  const tag = payload.subarray(MAGIC.length + 28, MAGIC.length + 44);
  const decipher = createDecipheriv("aes-256-gcm", keyFor(salt), iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(payload.subarray(MAGIC.length + 44)), decipher.final()]);
  const decoded = JSON.parse(plaintext.toString("utf8"));
  if (decoded.format !== "mortgage-lead-hub.logical-backup.v1" || !Array.isArray(decoded.tables)) throw new Error("Backup payload is incomplete");
  const rows = decoded.tables.reduce((sum, table) => sum + table.rows.length, 0);
  console.log(JSON.stringify({ verified: true, file: path.resolve(file), tables: decoded.tables.length, rows, checksum: createHash("sha256").update(plaintext).digest("hex") }, null, 2));
}

const verifyIndex = process.argv.indexOf("--verify");
if (verifyIndex >= 0) {
  await verify(process.argv[verifyIndex + 1]);
  process.exit(0);
}

const databaseUrl = process.env.DIRECT_URL || process.env.DATABASE_URL || process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
if (!databaseUrl) throw new Error("A database URL is required");
const url = new URL(databaseUrl);
const isSupabase = url.hostname.endsWith(".supabase.com");
const supabaseCa = process.env.SUPABASE_CA_CERT?.replace(/\\n/g, "\n");
const databaseCa = process.env.DATABASE_CA_CERT?.replace(/\\n/g, "\n");
if (isSupabase && !supabaseCa) throw new Error("SUPABASE_CA_CERT is required for verified Supabase TLS");
url.searchParams.delete("sslmode");
const client = new pg.Client({ connectionString: url.toString(), ssl: { ...(isSupabase ? { ca: supabaseCa } : databaseCa ? { ca: databaseCa } : {}), rejectUnauthorized: true } });

await client.connect();
let backup;
try {
  await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
  const tableRows = (await client.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema='public' AND table_type='BASE TABLE'
     ORDER BY table_name`
  )).rows;
  const tables = [];
  for (const { table_name: tableName } of tableRows) {
    if (!/^[a-z_][a-z0-9_]*$/i.test(tableName)) throw new Error("Unsafe table identifier returned by database");
    const columns = (await client.query(
      `SELECT column_name, data_type, udt_name, is_nullable, column_default
       FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position`,
      [tableName]
    )).rows;
    const rows = (await client.query(`SELECT * FROM public."${tableName}"`)).rows;
    tables.push({ name: tableName, columns, rows });
  }
  await client.query("COMMIT");
  backup = { format: "mortgage-lead-hub.logical-backup.v1", createdAt: new Date().toISOString(), databaseHostHash: createHash("sha256").update(url.hostname).digest("hex"), tables };
} catch (error) {
  await client.query("ROLLBACK").catch(() => undefined);
  throw error;
} finally {
  await client.end();
}

const plaintext = Buffer.from(JSON.stringify(backup), "utf8");
const salt = randomBytes(16);
const iv = randomBytes(12);
const cipher = createCipheriv("aes-256-gcm", keyFor(salt), iv);
const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
const output = Buffer.concat([MAGIC, salt, iv, cipher.getAuthTag(), encrypted]);
const directory = path.resolve(".backups");
await fs.mkdir(directory, { recursive: true, mode: 0o700 });
const stamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
const file = path.join(directory, `production-${stamp}.mlh.enc`);
await fs.writeFile(file, output, { mode: 0o600, flag: "wx" });
const rows = backup.tables.reduce((sum, table) => sum + table.rows.length, 0);
console.log(JSON.stringify({ created: true, file, encrypted: true, tables: backup.tables.length, rows, checksum: createHash("sha256").update(plaintext).digest("hex") }, null, 2));
await verify(file);
