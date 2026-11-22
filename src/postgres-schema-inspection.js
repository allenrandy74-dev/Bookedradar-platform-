import { createPostgresPool } from "./postgres-runtime.js";

const EXPECTED_TABLES = [
  "webhook_receipts",
  "provider_attempt_receipts",
  "call_control_state",
  "voice_calls",
  "call_turns",
  "lead_captures",
  "recovery_contacts",
  "recovery_opportunities",
  "recovery_events",
  "recovery_event_keys",
  "recovery_actions",
  "recovery_attribution",
  "web_chat_sessions",
  "transfer_records",
  "transfer_webhook_receipts",
  "billing_state",
  "growth_metrics",
  "migration_runs",
  "ops_incidents",
  "ops_notifications",
];

// Keep catalog defaults private; only recognized transaction-time semantics leave inspection.
function classifyTransactionTimeDefault(expression, dependencies) {
  const normalized = typeof expression === "string" ? expression.trim().toLowerCase().replace(/\s+/g, "") : "";
  if (!dependencies || !Array.isArray(dependencies.function_oids)
      || !/^[1-9][0-9]*$/.test(dependencies.builtin_now_oid || "")
      || !/^[1-9][0-9]*$/.test(dependencies.builtin_transaction_timestamp_oid || "")) return "unverified";
  const expected = ["now()", "pg_catalog.now()"].includes(normalized) ? dependencies.builtin_now_oid
    : ["transaction_timestamp()", "pg_catalog.transaction_timestamp()"].includes(normalized) ? dependencies.builtin_transaction_timestamp_oid
    : normalized === "current_timestamp" ? null : undefined;
  if (expected === undefined) return "unverified";
  // pg_depend omits references to pinned builtins. An explicitly returned empty
  // array is valid; absent metadata is not. Shadowing user functions have their
  // own dependency OIDs and must never pass merely because their name matches.
  return dependencies.function_oids.every(oid => expected !== null && oid === expected)
    ? "transaction_time" : "unverified";
}

export async function inspectPostgresSchema(pool) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const columns = await client.query(
      `SELECT table_name,column_name,data_type,is_nullable,column_default,datetime_precision,ordinal_position
       FROM information_schema.columns
       WHERE table_schema='bookedradar'
       ORDER BY table_name,ordinal_position`
    );
    const defaultFunctions = await client.query(
      `SELECT t.relname AS table_name, a.attname AS column_name,
              'pg_catalog.now()'::pg_catalog.regprocedure::pg_catalog.oid::text AS builtin_now_oid,
              'pg_catalog.transaction_timestamp()'::pg_catalog.regprocedure::pg_catalog.oid::text AS builtin_transaction_timestamp_oid,
              ARRAY(SELECT d.refobjid::text FROM pg_catalog.pg_depend d
                    WHERE d.classid='pg_catalog.pg_attrdef'::pg_catalog.regclass AND d.objid=ad.oid
                      AND d.refclassid='pg_catalog.pg_proc'::pg_catalog.regclass
                    ORDER BY d.refobjid) AS function_oids
       FROM pg_catalog.pg_attrdef ad
       JOIN pg_catalog.pg_class t ON t.oid=ad.adrelid
       JOIN pg_catalog.pg_namespace n ON n.oid=t.relnamespace
       JOIN pg_catalog.pg_attribute a ON a.attrelid=ad.adrelid AND a.attnum=ad.adnum
       WHERE n.nspname='bookedradar' AND t.relname='ops_notifications' AND a.attname='created_at'`
    );
    const constraints = await client.query(
      `SELECT tc.table_name,tc.constraint_name,tc.constraint_type,
              kcu.column_name,kcu.ordinal_position
       FROM information_schema.table_constraints tc
       LEFT JOIN information_schema.key_column_usage kcu
         ON tc.constraint_catalog=kcu.constraint_catalog
        AND tc.constraint_schema=kcu.constraint_schema
        AND tc.constraint_name=kcu.constraint_name
        AND tc.table_name=kcu.table_name
       WHERE tc.table_schema='bookedradar'
       ORDER BY tc.table_name,tc.constraint_name,kcu.ordinal_position`
    );
    const indexes = await client.query(
      `SELECT t.relname AS table_name, i.indisunique AS unique, i.indisprimary AS primary,
              i.indisvalid AS valid, i.indisready AS ready, i.indimmediate AS immediate,
              i.indpred IS NOT NULL AS partial, i.indexprs IS NOT NULL AS expression,
              ARRAY(SELECT a.attname::text FROM unnest(i.indkey) WITH ORDINALITY k(attnum, position)
                    LEFT JOIN pg_catalog.pg_attribute a ON a.attrelid=t.oid AND a.attnum=k.attnum
                    WHERE k.position <= i.indnkeyatts ORDER BY k.position) AS columns
       FROM pg_catalog.pg_index i
       JOIN pg_catalog.pg_class t ON t.oid=i.indrelid
       JOIN pg_catalog.pg_namespace n ON n.oid=t.relnamespace
       WHERE n.nspname='bookedradar'`
    );
    const checks = await client.query(
      `SELECT t.relname AS table_name, c.convalidated AS validated,
              pg_catalog.pg_get_expr(c.conbin,c.conrelid) AS expression
       FROM pg_catalog.pg_constraint c
       JOIN pg_catalog.pg_class t ON t.oid=c.conrelid
       JOIN pg_catalog.pg_namespace n ON n.oid=t.relnamespace
       WHERE n.nspname='bookedradar' AND c.contype='c'`
    );
    const foreignKeys = await client.query(
      `SELECT t.relname AS table_name, c.convalidated AS validated,
              rn.nspname AS referenced_schema, rt.relname AS referenced_table,
              ARRAY(SELECT a.attname::text FROM unnest(c.conkey) WITH ORDINALITY k(attnum, position)
                    JOIN pg_catalog.pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.attnum
                    ORDER BY k.position) AS columns,
              ARRAY(SELECT a.attname::text FROM unnest(c.confkey) WITH ORDINALITY k(attnum, position)
                    JOIN pg_catalog.pg_attribute a ON a.attrelid=c.confrelid AND a.attnum=k.attnum
                    ORDER BY k.position) AS referenced_columns
       FROM pg_catalog.pg_constraint c
       JOIN pg_catalog.pg_class t ON t.oid=c.conrelid
       JOIN pg_catalog.pg_namespace n ON n.oid=t.relnamespace
       JOIN pg_catalog.pg_class rt ON rt.oid=c.confrelid
       JOIN pg_catalog.pg_namespace rn ON rn.oid=rt.relnamespace
       WHERE n.nspname='bookedradar' AND c.contype='f'`
    );
    await client.query("COMMIT");

    const byTable = {};
    for (const row of columns.rows || []) {
      byTable[row.table_name] ??= { columns: [], constraints: [] };
      byTable[row.table_name].columns.push({
        name: row.column_name,
        type: row.data_type,
        nullable: row.is_nullable === "YES",
        hasDefault: row.column_default != null,
        datetimePrecision: Number.isInteger(row.datetime_precision) ? row.datetime_precision : null,
        ...(row.table_name === "ops_notifications" && row.column_name === "created_at"
          ? { defaultKind: classifyTransactionTimeDefault(row.column_default, defaultFunctions.rows?.find(d => d.table_name === row.table_name && d.column_name === row.column_name)) } : {}),
        position: Number(row.ordinal_position),
      });
    }
    for (const row of constraints.rows || []) {
      byTable[row.table_name] ??= { columns: [], constraints: [] };
      const key = `${row.constraint_name}|${row.constraint_type}`;
      let item = byTable[row.table_name].constraints.find(x => x.key === key);
      if (!item) {
        item = {
          key,
          name: row.constraint_name,
          type: row.constraint_type,
          columns: [],
        };
        byTable[row.table_name].constraints.push(item);
      }
      if (row.column_name) item.columns.push(row.column_name);
    }
    for (const row of indexes.rows || []) {
      if (byTable[row.table_name]) (byTable[row.table_name].indexes ??= []).push(row);
    }
    for (const row of checks.rows || []) {
      if (byTable[row.table_name]) (byTable[row.table_name].checks ??= []).push(row);
    }
    for (const row of foreignKeys.rows || []) {
      if (byTable[row.table_name]) (byTable[row.table_name].foreignKeys ??= []).push({
        columns: row.columns,
        referencedSchema: row.referenced_schema,
        referencedTable: row.referenced_table,
        referencedColumns: row.referenced_columns,
        validated: row.validated === true,
      });
    }
    for (const table of Object.values(byTable)) {
      for (const constraint of table.constraints) delete constraint.key;
    }

    const presentTables = Object.keys(byTable).sort();
    const expectedSet = new Set(EXPECTED_TABLES);
    const presentSet = new Set(presentTables);
    return {
      ok: true,
      schema: "bookedradar",
      tableCount: presentTables.length,
      expectedTableCount: EXPECTED_TABLES.length,
      missingTables: EXPECTED_TABLES.filter(name => !presentSet.has(name)),
      unexpectedTableCount: presentTables.filter(name => !expectedSet.has(name)).length,
      tables: byTable,
    };
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

export async function runStartupPostgresSchemaInspection({
  enabled = false,
  env = process.env,
  createPool = createPostgresPool,
  inspect = inspectPostgresSchema,
  log = () => {},
} = {}) {
  if (!enabled) return { enabled: false, status: "disabled" };
  const databaseUrl = String(env.DATABASE_URL || "").trim();
  if (!databaseUrl) {
    const result = { enabled:true,status:"unconfigured",ok:false,error:"database_url_required" };
    log("postgres.schema_inspection", result);
    return result;
  }
  let pool;
  try {
    pool = createPool({ connectionString:databaseUrl, max:1, connectionTimeoutMillis:5000 });
    const inspection = await inspect(pool);
    const result = { enabled:true,status:"complete",...inspection };
    log("postgres.schema_inspection", result);
    return result;
  } catch (error) {
    const result = {
      enabled:true,
      status:"failed",
      ok:false,
      error:"postgres_schema_inspection_failed",
    };
    log("postgres.schema_inspection", result);
    return result;
  } finally {
    if (pool) await pool.end();
  }
}

export { EXPECTED_TABLES };

// Catalog-only release gate. No DDL, DML, probe writes, or automatic migration.
export function validatePostgresReleaseSchema(inspection) {
  const issues = [];
  const tables = inspection?.tables || {};
  for (const name of EXPECTED_TABLES) if (!tables[name]) issues.push(`missing_table:${name}`);
  const column = (table, name, type, notNull = false) => {
    const actual = tables[table]?.columns?.find(c => c.name === name);
    if (!actual || actual.type !== type || (notNull && actual.nullable)) {
      issues.push(`incompatible_column:${table}.${name}`);
    }
  };
  column('provider_attempt_receipts', 'attempt_key', 'text', true);
  column('provider_attempt_receipts', 'payload', 'jsonb', true);
  column('recovery_events', 'tenant_id', 'text');
  column('recovery_events', 'idempotency_key', 'text');
  const exactKeys = (index, keys) => index.columns?.length === keys.length && keys.every(k => index.columns.includes(k));
  const usable = index => index.unique && index.valid && index.ready && index.immediate && !index.partial && !index.expression;
  const receiptIndexes = tables.provider_attempt_receipts?.indexes || [];
  if (!receiptIndexes.some(i => usable(i) && exactKeys(i, ['attempt_key']))) issues.push('provider_attempt_receipts_unique_key_required');
  if (receiptIndexes.some(i => i.unique && !i.immediate && exactKeys(i, ['attempt_key']))) issues.push('provider_attempt_receipts_deferrable_key_unsupported');
  // Conservatively accept the shipped object constraint, ignoring only formatting.
  const checks = tables.provider_attempt_receipts?.checks || [];
  if (!checks.some(c => c.validated && String(c.expression).replace(/[\s()]/g, '') === "jsonb_typeofpayload='object'::text")) {
    issues.push('provider_attempt_receipts_object_check_required');
  }
  const eventIndexes = tables.recovery_events?.indexes || [];
  if (!eventIndexes.some(i => usable(i) && exactKeys(i, ['tenant_id', 'idempotency_key']))) issues.push('recovery_events_tenant_unique_key_required');
  if (eventIndexes.some(i => i.unique && exactKeys(i, ['idempotency_key']))) issues.push('recovery_events_legacy_global_unique_key');
  column('ops_notifications', 'notification_id', 'text', true);
  column('ops_notifications', 'incident_key', 'text', true);
  column('ops_notifications', 'state', 'text', true);
  column('ops_notifications', 'created_at', 'timestamp with time zone', true);
  column('ops_incidents', 'last_notified_at', 'timestamp with time zone');
  for (const [table, name] of [['ops_notifications', 'created_at'], ['ops_incidents', 'last_notified_at']]) {
    if (tables[table]?.columns?.find(c => c.name === name)?.datetimePrecision !== 6) {
      issues.push(`ops_notification_fence_full_precision_required:${table}.${name}`);
    }
  }
  column('ops_notifications', 'provider_receipt', 'text');
  column('ops_notifications', 'payload', 'jsonb', true);
  const notificationIndexes = tables.ops_notifications?.indexes || [];
  if (!notificationIndexes.some(i => usable(i) && exactKeys(i, ['notification_id']))) issues.push('ops_notifications_unique_key_required');
  if (notificationIndexes.some(i => i.unique && !i.immediate && exactKeys(i, ['notification_id']))) issues.push('ops_notifications_deferrable_key_unsupported');
  if (tables.ops_notifications?.columns?.find(c => c.name === 'created_at')?.defaultKind !== 'transaction_time') issues.push('ops_notifications_transaction_time_default_required');
  const notificationForeignKeys = tables.ops_notifications?.foreignKeys || [];
  if (!notificationForeignKeys.some(fk => fk.validated === true
      && fk.columns?.length === 1 && fk.columns[0] === 'incident_key'
      && fk.referencedSchema === 'bookedradar' && fk.referencedTable === 'ops_incidents'
      && fk.referencedColumns?.length === 1 && fk.referencedColumns[0] === 'incident_key')) {
    issues.push('ops_notifications_validated_incident_fk_required');
  }
  const notificationChecks = tables.ops_notifications?.checks || [];
  if (!notificationChecks.some(c => c.validated && String(c.expression).replace(/[\s()]/g, '') === "state=ANYARRAY['pending'::text,'accepted'::text,'uncertain'::text,'not_sent'::text]")) {
    issues.push('ops_notifications_state_check_required');
  }
  return { ok: issues.length === 0, issues, requirement: 'db/postgres-schema.sql', version: 'durable-provider-attempts-ops-notifications-v2' };
}

export async function verifyPostgresReleaseSchema(pool) {
  let result;
  try {
    result = validatePostgresReleaseSchema(await inspectPostgresSchema(pool));
  } catch {
    // Driver messages may include connection details; never expose them here.
    throw new Error('postgres_release_schema_validation_failed: inspect database metadata permissions/connectivity; see docs/POSTGRES_RELEASE_READINESS.md');
  }
  if (!result.ok) {
    throw new Error(`postgres_release_schema_migration_required: ${result.issues.join(',')}; review db/postgres-schema.sql and docs/POSTGRES_RELEASE_READINESS.md before restart`);
  }
  return result;
}
