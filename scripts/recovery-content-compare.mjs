import { Pool } from "pg";

const urls = [process.env.SOURCE_DATABASE_URL, process.env.RESTORE_DATABASE_URL];
const hosts = [process.env.SOURCE_EXPECTED_HOST, process.env.RESTORE_EXPECTED_HOST];
for (let i = 0; i < 2; i++) {
  if (!hosts[i] || new URL(urls[i]).hostname !== hosts[i]) throw new Error("host_guard_failed");
}
if (hosts[0] === hosts[1]) throw new Error("distinct_database_hosts_required");

async function snapshot(url) {
  const pool = new Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 5000 });
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await client.query("SET LOCAL TIME ZONE 'UTC'");
    await client.query("SET LOCAL statement_timeout='15s'");
    const tables = await client.query("SELECT table_name FROM information_schema.tables WHERE table_schema='bookedradar' AND table_type='BASE TABLE' ORDER BY table_name");
    const out = {};
    for (const { table_name: name } of tables.rows) {
      if (!/^[a-z_]+$/.test(name)) throw new Error("invalid_identifier");
      out[name] = (await client.query(`SELECT count(*)::int AS rows, md5(coalesce(string_agg(md5(t::text),'' ORDER BY md5(t::text)),'')) AS fingerprint FROM bookedradar.${name} t`)).rows[0];
    }
    await client.query("COMMIT");
    return out;
  } finally {
    client.release();
    await pool.end();
  }
}

try {
  const [source, restored] = await Promise.all(urls.map(snapshot));
  const names = [...new Set([...Object.keys(source), ...Object.keys(restored)])].sort();
  const differences = names.filter(name => JSON.stringify(source[name]) !== JSON.stringify(restored[name]));
  console.log(JSON.stringify({ event: "recovery.content_compare", at: new Date().toISOString(), ok: differences.length === 0,
    sourceTables: Object.keys(source).length, restoredTables: Object.keys(restored).length,
    sourceRows: Object.values(source).reduce((sum, row) => sum + row.rows, 0),
    restoredRows: Object.values(restored).reduce((sum, row) => sum + row.rows, 0),
    differingTables: differences, opsIncidentsPresent: Boolean(source.ops_incidents && restored.ops_incidents) }));
  if (differences.length) process.exitCode = 1;
} catch (error) {
  console.log(JSON.stringify({ event: "recovery.content_compare", ok: false, errorCode: error.code || "comparison_failed" }));
  process.exitCode = 1;
}
