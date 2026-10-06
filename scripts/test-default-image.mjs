// CI-only Docker smoke test. Never receives provider credentials or DB access.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const image = process.argv[2];
assert.match(image || '', /^[a-z0-9][a-z0-9:._/-]+$/);
const service = 'srv-dam8f7bm8hqs73ct778g';
const original = {
  VOICE_ENABLED: 'true', DISPATCH_ENABLED: 'false', OPS_ALERTS_ENABLED: 'true',
  BOOKEDRADAR_BILLING_ENABLED: 'true', BOOKEDRADAR_BILLING_LIVE_ARMED: 'false',
  WARM_TRANSFER_ENABLED: 'false', DEMO_NUMBER_PROVISION_MODE: 'off',
  POSTGRES_PRODUCTION_ARMED: 'true', POSTGRES_STATELESS_MODE: 'true',
  POSTGRES_HEALTH_ON_STARTUP: 'true', POSTGRES_SHADOW_IMPORT_ON_STARTUP: 'false',
  POSTGRES_JSON_ROLLBACK_ON_STARTUP: 'false', POSTGRES_MIGRATION_AUDIT_ON_STARTUP: 'false',
  POSTGRES_RESTORE_DRILL_ON_STARTUP: 'false', POSTGRES_MIGRATION_DIFF_ON_STARTUP: 'false',
};
const common = {
  NODE_ENV: 'production', NODE_NO_WARNINGS: '1',
  NODE_OPTIONS: '--require /app/transport.cjs --experimental-loader /app/guard.mjs',
  RENDER_SERVICE_ID: service, RENDER_SERVICE_NAME: 'bookedradar-platform',
  BOOKEDRADAR_STORAGE_BACKEND: 'postgres', PORT: '5050',
  DATABASE_URL: 'postgresql://synthetic:disposable_ci_only@dpg-date5bk9v7es738c22pg-a/bookedradar_postgres_production',
  ...original,
};
const containers = new Set();
function docker(args) {
  const result = spawnSync('docker', args, { encoding: 'utf8', timeout: 30_000, maxBuffer: 2 * 1024 * 1024 });
  assert.ifError(result.error);
  assert.equal(result.status, 0, `docker ${args[0]} failed: ${result.stderr}`);
  return result.stdout.trim();
}
function create(overrides) {
  const env = { ...common, ...overrides };
  const args = ['create', '--network', 'none'];
  for (const [key, value] of Object.entries(env)) if (value !== undefined) args.push('--env', `${key}=${value}`);
  // No --entrypoint and no command arguments after image: test actual image CMD.
  const id = docker([...args, image]);
  containers.add(id);
  const state = JSON.parse(docker(['inspect', id]))[0];
  assert.deepEqual(state.Config.Cmd, ['node', 'startup.mjs']);
  assert.equal(state.HostConfig.NetworkMode, 'none');
  for (const [source, target] of [['maintenance-import-guard.mjs', 'guard.mjs'], ['maintenance-transport-guard.cjs', 'transport.cjs']]) {
    docker(['cp', fileURLToPath(new URL(`../test/fixtures/${source}`, import.meta.url)), `${id}:/app/${target}`]);
  }
  docker(['start', id]);
  return { id, env };
}
function inspectFiles(id) {
  // Helper process alone clears NODE_OPTIONS; the default-command process retains guards.
  return JSON.parse(docker(['exec', '--env', 'NODE_OPTIONS=', id, 'node', '--input-type=module', '-e', `
    import {readFileSync,existsSync} from 'node:fs';
    console.log(JSON.stringify({imports:readFileSync('/app/imports.txt','utf8').trim().split('\\n'),
      transport:existsSync('/app/transport-attempts.txt'),timers:existsSync('/app/timer-attempts.txt')}));
  `]));
}
function wait(id, expected) {
  assert.equal(docker(['wait', id]), String(expected));
  const state = JSON.parse(docker(['inspect', id]))[0];
  assert.equal(state.State.OOMKilled, false);
  assert.equal(state.State.ExitCode, expected);
  return docker(['logs', id]);
}
try {
  const maintenance = create({ BOOKEDRADAR_MAINTENANCE_MODE: 'true', BOOKEDRADAR_MAINTENANCE_SERVICE_ID: service });
  docker(['exec', '--env', 'NODE_OPTIONS=', maintenance.id, 'node', '--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    let ready = false;
    for (let i=0;i<100;i++) {
      try {
        const response = await fetch('http://127.0.0.1:5050/health');
        assert.equal(response.status,200);
        assert.deepEqual(await response.json(),{status:'maintenance',mode:'maintenance',customerReady:false,acceptingWork:false});
        ready=true; break;
      } catch { await new Promise(r=>setTimeout(r,100)); }
    }
    assert.ok(ready,'default CMD did not start maintenance');
    const response=await fetch('http://127.0.0.1:5050/webhooks/openai',{method:'POST',body:'synthetic'});
    assert.equal(response.status,503);
    const body=await response.json(); assert.equal(body.accepted,false); assert.equal(body.customerReady,false);
  `]);
  const files = inspectFiles(maintenance.id);
  assert.deepEqual(files.imports, ['file:///app/startup.mjs', 'node:http', 'node:crypto']);
  assert.equal(files.transport, false);
  assert.equal(files.timers, false);
  docker(['kill', '--signal', 'TERM', maintenance.id]);
  assert.match(wait(maintenance.id, 0), /"event":"maintenance.shutdown","signal":"SIGTERM"/);
  console.log('default CMD maintenance: liveness200, work503, no application imports/transports/timers, clean SIGTERM');

  for (const [settings, expectedError] of [
    [{ BOOKEDRADAR_MAINTENANCE_MODE: 'TRUE', BOOKEDRADAR_MAINTENANCE_SERVICE_ID: service }, 'maintenance_flag_invalid'],
    [{ BOOKEDRADAR_MAINTENANCE_MODE: 'true', BOOKEDRADAR_MAINTENANCE_SERVICE_ID: service, RENDER_SERVICE_ID: 'srv-wrong-synthetic' }, 'maintenance_production_identity_required'],
  ]) {
    const invalid = create(settings);
    wait(invalid.id, 1);
    const invalidLogs = spawnSync('docker', ['logs', invalid.id], {encoding:'utf8',timeout:10_000});
    assert.ifError(invalidLogs.error);
    assert.equal(invalidLogs.status,0);
    assert.equal((invalidLogs.stdout + invalidLogs.stderr).trim(), expectedError);
    console.log(`default CMD rejection: ${expectedError}`);
  }

  for (const mode of [undefined, 'false']) {
    const normal = create({ BOOKEDRADAR_MAINTENANCE_MODE: mode, TEST_ALLOW_SERVER_IMPORT: 'true' });
    const output = wait(normal.id, 0);
    const record = JSON.parse(output);
    assert.equal(record.event, 'test.normal_server_imported');
    for (const [key,value] of Object.entries(normal.env)) assert.equal(record.env[key],value,key);
    assert.equal(record.env.BOOKEDRADAR_MAINTENANCE_SERVICE_ID,undefined);
  }
  console.log('default CMD normal absent/false mode: exact server import selected, original flags preserved (stubbed server)');
} finally {
  for (const id of containers) spawnSync('docker', ['rm', '--force', id], {encoding:'utf8',timeout:10_000});
}
