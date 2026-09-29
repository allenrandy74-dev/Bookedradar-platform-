import test from "node:test";
import assert from "node:assert/strict";
import { validateStatelessPostgresProduction } from "../src/stateless-production.js";

const fingerprint="4de6c957e16a247a73cbff78cd2ce175044995b7e83fd0aecd1940bd120bd75e";
const migrationId="production-shadow-20260929-final";

function env(overrides={}) {
  return {
    POSTGRES_STATELESS_MODE:"true",
    BOOKEDRADAR_STORAGE_BACKEND:"postgres",
    POSTGRES_PRODUCTION_ARMED:"true",
    DATABASE_URL:"postgresql://bookedradar:secret@internal.render/bookedradar_postgres_production",
    POSTGRES_VALIDATED_MIGRATION_ID:migrationId,
    POSTGRES_VALIDATED_SNAPSHOT_FINGERPRINT:fingerprint,
    POSTGRES_MIGRATION_AUDIT_ON_STARTUP:"false",
    POSTGRES_SHADOW_IMPORT_ON_STARTUP:"false",
    POSTGRES_MIGRATION_DIFF_ON_STARTUP:"false",
    POSTGRES_JSON_ROLLBACK_ON_STARTUP:"false",
    POSTGRES_JSON_ROLLBACK_ARMED:"false",
    POSTGRES_MIGRATION_ARMED:"false",
    ...overrides,
  };
}

test("stateless mode is disabled unless explicitly enabled",()=>{
  assert.deepEqual(validateStatelessPostgresProduction({}),{
    enabled:false,status:"disabled",
  });
});

test("stateless production accepts only validated Postgres authority",()=>{
  const result=validateStatelessPostgresProduction(env());
  assert.deepEqual(result,{
    enabled:true,
    status:"ready",
    backend:"postgres",
    migrationId,
    snapshotFingerprint:fingerprint,
    fileAuthority:false,
  });
});

test("stateless production refuses JSON, unarmed Postgres, and missing validation",()=>{
  assert.throws(
    ()=>validateStatelessPostgresProduction(env({BOOKEDRADAR_STORAGE_BACKEND:"json"})),
    /requires_postgres_backend/
  );
  assert.throws(
    ()=>validateStatelessPostgresProduction(env({POSTGRES_PRODUCTION_ARMED:"false"})),
    /requires_postgres_production_armed/
  );
  assert.throws(
    ()=>validateStatelessPostgresProduction(env({DATABASE_URL:""})),
    /requires_database_url/
  );
  assert.throws(
    ()=>validateStatelessPostgresProduction(env({POSTGRES_VALIDATED_MIGRATION_ID:""})),
    /validated_migration_required/
  );
  assert.throws(
    ()=>validateStatelessPostgresProduction(env({POSTGRES_VALIDATED_SNAPSHOT_FINGERPRINT:"bad"})),
    /validated_fingerprint_required/
  );
});

test("stateless production refuses every file-backed migration or rollback startup feature",()=>{
  const forbidden=[
    "POSTGRES_MIGRATION_AUDIT_ON_STARTUP",
    "POSTGRES_SHADOW_IMPORT_ON_STARTUP",
    "POSTGRES_MIGRATION_DIFF_ON_STARTUP",
    "POSTGRES_JSON_ROLLBACK_ON_STARTUP",
    "POSTGRES_JSON_ROLLBACK_ARMED",
    "POSTGRES_MIGRATION_ARMED",
  ];
  for(const key of forbidden){
    assert.throws(
      ()=>validateStatelessPostgresProduction(env({[key]:"true"})),
      error=>
        error?.message==="stateless_mode_file_dependency_enabled" &&
        Array.isArray(error.forbidden) &&
        error.forbidden.includes(key)
    );
  }
});

test("stateless mode ignores file paths because they are not authority inputs",()=>{
  const result=validateStatelessPostgresProduction(env({
    STATE_FILE:"/proc/bookedradar-denied/state.json",
    RECOVERY_STATE_FILE:"/proc/bookedradar-denied/recovery.json",
    CALL_HISTORY_FILE:"/proc/bookedradar-denied/history.json",
    WEB_CHAT_STATE_FILE:"/proc/bookedradar-denied/chat.json",
    LEADS_FILE:"/proc/bookedradar-denied/leads.jsonl",
  }));
  assert.equal(result.status,"ready");
  assert.equal(result.fileAuthority,false);
});
