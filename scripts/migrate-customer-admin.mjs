import process from "node:process";
import pg from "pg";

const databaseUrl = process.env.DIRECT_URL || process.env.DATABASE_URL || process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
const targetEmail = (process.env.CUSTOMER_ADMIN_EMAIL || "inquiries@equityflowgroup.com").trim().toLowerCase();
const suppliedPasswordHash = process.env.CUSTOMER_ADMIN_PASSWORD_HASH || null;
if (!databaseUrl) throw new Error("A production database URL is required");
if (suppliedPasswordHash && !/^[0-9a-f]{32}:[0-9a-f]{128}$/i.test(suppliedPasswordHash)) {
  throw new Error("CUSTOMER_ADMIN_PASSWORD_HASH is not a valid application password hash");
}

const url = new URL(databaseUrl);
const isSupabase = url.hostname.endsWith(".supabase.com");
const supabaseCa = process.env.SUPABASE_CA_CERT?.replace(/\\n/g, "\n");
const databaseCa = process.env.DATABASE_CA_CERT?.replace(/\\n/g, "\n");
if (isSupabase && !supabaseCa) throw new Error("SUPABASE_CA_CERT is required for verified Supabase TLS");
url.searchParams.delete("sslmode");
const client = new pg.Client({
  connectionString: url.toString(),
  ssl: { ...(isSupabase ? { ca: supabaseCa } : databaseCa ? { ca: databaseCa } : {}), rejectUnauthorized: true },
});

await client.connect();
try {
  await client.query("BEGIN");
  const row = (await client.query("SELECT value, revision FROM mlh_store WHERE key='main' FOR UPDATE")).rows[0];
  if (!row) throw new Error("Legacy CRM snapshot mlh_store/main was not found");
  const snapshot = row.value;
  const users = new Map(Array.isArray(snapshot.users) ? snapshot.users : []);
  const sourceAdmin = users.get("user_admin") || [...users.values()].find((user) => user?.role === "ADMIN");
  if (!sourceAdmin) throw new Error("No administrator account exists in the CRM snapshot");
  const existingCustomer = [...users.values()].find((user) => user?.email?.toLowerCase() === targetEmail);
  const mergingAccounts = Boolean(existingCustomer && existingCustomer.id !== sourceAdmin.id);
  const admin = mergingAccounts ? existingCustomer : sourceAdmin;
  const identityChanging = !mergingAccounts && admin.email?.toLowerCase() !== targetEmail;

  await client.query(`CREATE TABLE IF NOT EXISTS mlh_store_backups (
    label TEXT PRIMARY KEY, value JSONB NOT NULL, revision BIGINT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  await client.query(
    "INSERT INTO mlh_store_backups (label, value, revision) VALUES ($1,$2::jsonb,$3) ON CONFLICT (label) DO NOTHING",
    ["before_customer_admin_2026_08_22", JSON.stringify(snapshot), Number(row.revision ?? 0)]
  );

  if (mergingAccounts) {
    sourceAdmin.isActive = false;
    users.set(sourceAdmin.id, sourceAdmin);
  }
  admin.email = targetEmail;
  admin.name = "Equity Flow Group Admin";
  admin.role = "ADMIN";
  admin.isActive = true;
  if (identityChanging) {
    delete admin.passwordHash;
    admin.failedLoginAttempts = 0;
    delete admin.lockedUntil;
  }
  if (suppliedPasswordHash) {
    admin.passwordHash = suppliedPasswordHash;
    admin.failedLoginAttempts = 0;
    delete admin.lockedUntil;
  }
  users.set(admin.id, admin);
  snapshot.users = [...users.entries()];

  if (suppliedPasswordHash) {
    const authTokens = new Map(Array.isArray(snapshot.authTokens) ? snapshot.authTokens : []);
    for (const [token, authToken] of authTokens) {
      if (authToken?.userId === admin.id) authTokens.delete(token);
    }
    snapshot.authTokens = [...authTokens.entries()];
  }

  const sessions = new Map(Array.isArray(snapshot.sessions) ? snapshot.sessions : []);
  if (identityChanging || mergingAccounts) {
    const revokedUserId = mergingAccounts ? sourceAdmin.id : admin.id;
    for (const [token, session] of sessions) if (session?.userId === revokedUserId) sessions.delete(token);
  }
  snapshot.sessions = [...sessions.entries()];

  const updated = await client.query(
    `UPDATE mlh_store SET value=$1::jsonb, revision=revision+1, updated_at=now()
     WHERE key='main' AND revision=$2 RETURNING revision`,
    [JSON.stringify(snapshot), Number(row.revision ?? 0)]
  );
  if (updated.rowCount !== 1) throw new Error("Customer admin migration lost its revision lock");

  await client.query(
    `UPDATE app_users SET email_normalized=$1, role='ADMIN',
       password_hash=CASE WHEN $4::text IS NOT NULL THEN $4 WHEN $3 THEN NULL ELSE password_hash END,
       failed_login_attempts=CASE WHEN $3 OR $4::text IS NOT NULL THEN 0 ELSE failed_login_attempts END,
       locked_until=CASE WHEN $3 OR $4::text IS NOT NULL THEN NULL ELSE locked_until END,
       active=true, data=jsonb_set(jsonb_set(data, '{email}', to_jsonb($1::text)), '{name}', to_jsonb('Equity Flow Group Admin'::text))
     WHERE id=$2`,
    [targetEmail, admin.id, identityChanging, suppliedPasswordHash]
  );
  if (mergingAccounts) {
    await client.query("UPDATE app_users SET active=false WHERE id=$1", [sourceAdmin.id]);
    await client.query("DELETE FROM auth_sessions WHERE user_id=$1", [sourceAdmin.id]);
  } else if (identityChanging) {
    await client.query("DELETE FROM auth_sessions WHERE user_id=$1", [admin.id]);
  }
  await client.query("COMMIT");
  console.log(JSON.stringify({
    customerAdminMigrated: identityChanging || mergingAccounts,
    mergedExistingCustomerAccount: mergingAccounts,
    email: targetEmail,
    oldAdminSessionsRevoked: identityChanging || mergingAccounts,
    passwordSetupRequired: !admin.passwordHash,
    temporaryPasswordInstalled: Boolean(suppliedPasswordHash),
  }));
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  await client.end();
}
