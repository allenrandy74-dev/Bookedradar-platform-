import { createPostgresPool } from "./postgres-runtime.js";

const EXPECTED_TABLES = [
  "webhook_receipts",
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
];

export async function inspectPostgresSchema(pool) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const columns = await client.query(
      `SELECT table_name,column_name,data_type,is_nullable,column_default,ordinal_position
       FROM information_schema.columns
       WHERE table_schema='bookedradar'
       ORDER BY table_name,ordinal_position`
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
    await client.query("COMMIT");

    const byTable = {};
    for (const row of columns.rows || []) {
      byTable[row.table_name] ??= { columns: [], constraints: [] };
      byTable[row.table_name].columns.push({
        name: row.column_name,
        type: row.data_type,
        nullable: row.is_nullable === "YES",
        hasDefault: row.column_default != null,
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
      error:String(error?.message || "postgres_schema_inspection_failed").slice(0,200),
    };
    log("postgres.schema_inspection", result);
    return result;
  } finally {
    if (pool) await pool.end();
  }
}

export { EXPECTED_TABLES };
