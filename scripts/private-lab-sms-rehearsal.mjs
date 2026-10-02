import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Pool } from 'pg';
import { validateLabEnvironment, validateExistingLabDatabase } from './private-voice-lab-start.mjs';
import { runSmsPersistenceRehearsal, verifyDisabledSmsEntryPoints } from './lib/private-lab-sms-rehearsal-core.mjs';

const OFF_FLAGS = ['VOICE_ENABLED', 'DISPATCH_ENABLED', 'BOOKEDRADAR_BILLING_ENABLED', 'OPS_ALERTS_ENABLED'];
const SAFE_CODES = new Set(['sms_rehearsal_arguments_invalid', 'sms_rehearsal_environment_rejected',
  'sms_rehearsal_flags_must_be_false', 'sms_rehearsal_host_mismatch', 'sms_rehearsal_database_url_rejected',
  'sms_rehearsal_migration_rejected', 'sms_rehearsal_checks_failed', 'sms_rehearsal_cleanup_failed']);

export function validateSmsRehearsalEnvironment(env, args) {
  // Operator must compare this explicit, non-secret host with the reviewed
  // private Render DB target. No credentials/URL, options, or guard override CLI.
  if (args.length !== 1 || !/^--expected-host=dpg-[a-z0-9-]+$/.test(args[0])) {
    throw new Error('sms_rehearsal_arguments_invalid');
  }
  const expectedHost = args[0].slice('--expected-host='.length);
  try { validateLabEnvironment(env); }
  catch { throw new Error('sms_rehearsal_environment_rejected'); }
  for (const key of OFF_FLAGS) if (env[key] !== 'false') throw new Error('sms_rehearsal_flags_must_be_false');
  const url = new URL(env.DATABASE_URL);
  // pg connection-string query parameters can override the parsed host/database.
  if (url.search || url.hash || url.port && url.port !== '5432') throw new Error('sms_rehearsal_database_url_rejected');
  if (url.hostname !== expectedHost || env.PRIVATE_VOICE_LAB_DATABASE_HOST !== expectedHost) {
    throw new Error('sms_rehearsal_host_mismatch');
  }
  return { expectedHost };
}

export function safeFailureReport(error) {
  const report = { event: 'private_lab.sms_database_rehearsal_failed', ok: false,
    error: SAFE_CODES.has(error?.message) ? error.message : 'sms_rehearsal_checks_failed',
    providerCalls: 0, providerAcceptanceVerified: false, deliveryVerified: false,
    databaseSequenceMayAdvance: true, cleanupVerified: error?.cleanupVerified === true };
  if (report.error === 'sms_rehearsal_cleanup_failed' && Array.isArray(error?.fixtureTenantIds)) {
    // Only the two internally generated namespace identifiers may be emitted.
    report.fixtureTenantIds = error.fixtureTenantIds.filter(id => /^synthetic-sms-rehearsal-[0-9a-f-]{36}-[ab]$/.test(id)).slice(0, 2);
  }
  return report;
}

export function smsRehearsalPoolConfig(env, args) {
  validateSmsRehearsalEnvironment(env, args);
  const url = new URL(env.DATABASE_URL);
  // Pin in the URL itself: node-postgres parses connectionString after options,
  // and an omitted URL port would otherwise inherit ambient PGPORT.
  url.port = '5432';
  return { connectionString: url.href, max: 4,
    connectionTimeoutMillis: 5000, statement_timeout: 5000, query_timeout: 8000,
    idle_in_transaction_session_timeout: 10000, application_name: 'bookedradar-private-sms-rehearsal' };
}

export async function main(env = process.env, args = process.argv.slice(2)) {
  const config = smsRehearsalPoolConfig(env, args);
  await verifyDisabledSmsEntryPoints(env);
  const pool = new Pool(config);
  // Avoid pg's unhandled idle-client error event exposing connection details.
  pool.on('error', () => {});
  try {
    try { await validateExistingLabDatabase(pool); }
    catch { throw new Error('sms_rehearsal_migration_rejected'); }
    const result = await runSmsPersistenceRehearsal(pool, { onStart: marker => console.log(JSON.stringify(marker)) });
    validateSmsRehearsalEnvironment(env, args);
    await verifyDisabledSmsEntryPoints(env);
    return { ...result, disabledRuntimeGatesVerified: true, globalFlagsStayedFalse: true,
      validatedExistingMigration: true };
  } finally { await pool.end(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().then(result => console.log(JSON.stringify(result))).catch(error => {
    console.error(JSON.stringify(safeFailureReport(error))); process.exitCode = 1;
  });
}
