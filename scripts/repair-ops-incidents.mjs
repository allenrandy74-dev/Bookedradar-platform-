import fs from "node:fs/promises";
import { Pool } from "pg";

// Explicit host guard prevents a stale shell connection from targeting another database.
const connectionString = process.env.DATABASE_URL;
const expectedHost = process.env.OPS_REPAIR_EXPECTED_HOST;
if (!expectedHost || new URL(connectionString).hostname !== expectedHost) throw new Error("ops_repair_host_guard_failed");
const apply = process.argv.includes("--apply");
const schema = await fs.readFile(new URL("../db/postgres-schema.sql", import.meta.url), "utf8");
const sql = schema.match(/CREATE TABLE IF NOT EXISTS bookedradar\.ops_incidents \([\s\S]*?CREATE INDEX IF NOT EXISTS ops_incidents_scope_status_idx[\s\S]*?;/)?.[0];
if (!sql || (sql.match(/CREATE TABLE/g) || []).length !== 1) throw new Error("ops_repair_schema_source_invalid");
const pool = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 5000 });
const client = await pool.connect();
try {
  await client.query(apply ? "BEGIN" : "BEGIN READ ONLY");
  await client.query("SET LOCAL statement_timeout='15s'");
  await client.query("SET LOCAL lock_timeout='5s'");
  if (apply) {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('bookedradar_schema_migration'))");
    await client.query(sql);
  }
  const columns = (await client.query("SELECT column_name,data_type,is_nullable FROM information_schema.columns WHERE table_schema='bookedradar' AND table_name='ops_incidents' ORDER BY ordinal_position")).rows;
  const expected = ["incident_key:text:NO", "scope_key:text:NO", "severity:text:NO", "status:text:NO", "first_seen_at:timestamp with time zone:NO", "last_seen_at:timestamp with time zone:NO", "last_notified_at:timestamp with time zone:YES", "resolved_at:timestamp with time zone:YES", "occurrences:bigint:NO", "payload:jsonb:NO"];
  const actual = columns.map(row => `${row.column_name}:${row.data_type}:${row.is_nullable}`);
  const pk = (await client.query("SELECT array_agg(k.column_name ORDER BY k.ordinal_position) AS columns FROM information_schema.table_constraints t JOIN information_schema.key_column_usage k USING (constraint_catalog,constraint_schema,constraint_name,table_name) WHERE t.table_schema='bookedradar' AND t.table_name='ops_incidents' AND t.constraint_type='PRIMARY KEY'")).rows[0]?.columns;
  const index = (await client.query("SELECT indexdef FROM pg_indexes WHERE schemaname='bookedradar' AND tablename='ops_incidents' AND indexname='ops_incidents_scope_status_idx'")).rows[0]?.indexdef;
  const ok = JSON.stringify(actual) === JSON.stringify(expected) && JSON.stringify(pk) === '["incident_key"]' && Boolean(index?.includes("(scope_key, status, last_seen_at DESC)"));
  if (apply && !ok) throw new Error("ops_repair_verification_failed");
  await client.query("COMMIT");
  console.log(JSON.stringify({ event: "postgres.ops_incidents_repair", mode: apply ? "apply" : "inspect", ok, tablePresent: columns.length > 0, columnsVerified: actual.length, primaryKeyVerified: JSON.stringify(pk) === '["incident_key"]', scopeIndexVerified: Boolean(index?.includes("(scope_key, status, last_seen_at DESC)")) }));
  if (!ok) process.exitCode = 1;
} catch (error) {
  await client.query("ROLLBACK").catch(() => {});
  console.error(JSON.stringify({ event: "postgres.ops_incidents_repair", ok: false, errorCode: error.code || "repair_failed" }));
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
