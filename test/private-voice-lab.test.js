import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {validateLabEnvironment,isolateTenant,LAB_NAME,LAB_DATABASE,CRAFTS} from '../scripts/private-voice-lab-start.mjs';
import {validateTenant} from '../src/recovery/tenant.js';
import {humanTransferTarget} from '../src/recovery/tenant-registry.js';
const env={PRIVATE_VOICE_LAB:'true',RENDER_SERVICE_NAME:LAB_NAME,DATABASE_URL:`postgresql://u:p@dpg-private-lab/${LAB_DATABASE}`,PRIVATE_VOICE_LAB_DATABASE_HOST:'dpg-private-lab',OPENAI_PROJECT_ID:'proj_O0Mk7nAzTfe0AIys8Ukwd1cn',VOICE_ENABLED:'false'};
test('private voice lab rejects production service and database settings',()=>{
  assert.deepEqual(validateLabEnvironment(env),{});
  for(const change of [{RENDER_SERVICE_NAME:'bookedradar-platform'},{PRIVATE_VOICE_LAB:'false'},
    {DATABASE_URL:'postgresql://u:p@dpg-production/production'}, {PRIVATE_VOICE_LAB_DATABASE_HOST:'dpg-different'},
    {OPENAI_PROJECT_ID:'proj-production'},{VOICE_ENABLED:'true'}]) {
    assert.throws(()=>validateLabEnvironment({...env,...change}));
  }
});
test('private lab refuses customer integration credentials and dispatch',()=>{
  for(const change of [{TWILIO_AUTH_TOKEN:'secret'},{DEMO_HVAC_WIX_API_KEY:'secret'},{RESEND_API_KEY:'secret'},
    {STRIPE_SECRET_KEY:'secret'},{DISPATCH_ENABLED:'true'},{OPS_ALERTS_ENABLED:'true'},{POSTGRES_SHADOW_IMPORT_ON_STARTUP:'true'},{POSTGRES_RESTORE_DRILL_ON_STARTUP:'true'},{POSTGRES_JSON_ROLLBACK_ON_STARTUP:'true'},
    {DEMO_HVAC_HUMAN_TRANSFER_NUMBER:'+14095550100'}]) assert.throws(()=>validateLabEnvironment({...env,...change}),/external_integration/);
});
test('all five isolated crafts validate without dialable transfer or customer channels',async()=>{
  for(const craft of CRAFTS) {
    const source=JSON.parse(await fs.readFile(new URL(`../config/tenants/demo-${craft}.json`,import.meta.url)));
    const tenant=isolateTenant(source,craft,'+14095550100');
    assert.equal(validateTenant(tenant).valid,true);
    assert.equal(humanTransferTarget(tenant,{}),'');
    assert.deepEqual(Object.keys(tenant.integrations),['phone']);
    assert.equal(tenant.commercial.dispatchMode,'shadow');
    assert.equal(tenant.features.callerTexting,false);
    assert.notEqual(source.tenantId,tenant.tenantId);
  }
});
test('armed lab supports staged private routes while rejecting public and duplicate destinations',()=>{
  const oneRoute={hvac:'+14095550101'};
  const armed={...env,VOICE_ENABLED:'true',OPENAI_API_KEY:'test-key',OPENAI_WEBHOOK_SECRET:'test-signature',PRIVATE_VOICE_LAB_NUMBERS:JSON.stringify(oneRoute)};
  assert.deepEqual(validateLabEnvironment(armed),oneRoute);
  const numbers=Object.fromEntries(CRAFTS.map((craft,i)=>[craft,`+1409555010${i+1}`]));
  assert.deepEqual(validateLabEnvironment({...armed,PRIVATE_VOICE_LAB_NUMBERS:JSON.stringify(numbers)}),numbers);
  assert.throws(()=>validateLabEnvironment({...armed,PRIVATE_VOICE_LAB_NUMBERS:'{}'}),/route_required/);
  assert.throws(()=>validateLabEnvironment({...armed,PRIVATE_VOICE_LAB_NUMBERS:JSON.stringify({unknown:'+14095550108'})}),/unknown_route/);
  assert.throws(()=>validateLabEnvironment({...armed,PRIVATE_VOICE_LAB_NUMBERS:JSON.stringify({hvac:'+14092574186'})}),/public_demo_target/);
  assert.throws(()=>validateLabEnvironment({...armed,PRIVATE_VOICE_LAB_NUMBERS:JSON.stringify({hvac:'+14095550101',plumbing:'+14095550101'})}),/duplicate/);
});

test('lab guard refuses enabled action flags regardless of case or whitespace',()=>{
  for(const key of ['POSTGRES_SHADOW_IMPORT_ON_STARTUP','POSTGRES_RESTORE_DRILL_ON_STARTUP','POSTGRES_JSON_ROLLBACK_ON_STARTUP','POSTGRES_MIGRATION_AUDIT_ON_STARTUP','CRM_SMOKE_TEST_ON_STARTUP','EMAIL_SMOKE_TEST_ON_STARTUP','E2E_SMOKE_TEST_ON_STARTUP','TWILIO_A2P_DIAGNOSTIC_ON_STARTUP','DISPATCH_ENABLED','BOOKEDRADAR_BILLING_ENABLED','OPS_ALERTS_ENABLED']) {
    for(const value of ['TRUE','True',' true ']) assert.throws(()=>validateLabEnvironment({...env,[key]:value}),/external_integration/,`${key}=${value}`);
  }
});
