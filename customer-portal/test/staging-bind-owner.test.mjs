import test from 'node:test';
import assert from 'node:assert/strict';
import { ownerBindingCliConfig,activateStagingOwner } from '../server/staging-bind-owner.mjs';
import { STAGING } from '../server/staging-config.mjs';

const host='dpg-datimd2d0e5s73c926tg-a';
const env=()=>({PORTAL_STAGING_ENABLED:'true',PRIVATE_VOICE_LAB:'true',RENDER_SERVICE_NAME:STAGING.deploymentName,
  PORTAL_STAGING_ORIGIN:STAGING.origin,PRIVATE_VOICE_LAB_DATABASE_HOST:host,
  DATABASE_URL:`postgresql://synthetic:fixture_only@${host}/${STAGING.databaseName}`,
  VOICE_ENABLED:'false',DISPATCH_ENABLED:'false',BOOKEDRADAR_BILLING_ENABLED:'false',OPS_ALERTS_ENABLED:'false',WARM_TRANSFER_ENABLED:'false',DEMO_NUMBER_PROVISION_MODE:'off'});

test('owner binding CLI reuses actual deployment/destination/provider-off gates before connection',()=>{
  assert.equal(ownerBindingCliConfig(env()).schema,STAGING.schema);
  assert.equal(ownerBindingCliConfig({...env(),PORTAL_STAGING_SETUP:'false'}).databaseName,STAGING.databaseName);
  for(const patch of [
    {PORTAL_STAGING_ENABLED:'false'}, {PRIVATE_VOICE_LAB:'false'}, {RENDER_SERVICE_NAME:'bookedradar-platform'},
    {PORTAL_STAGING_ORIGIN:'https://bookedradar.com'}, {PRIVATE_VOICE_LAB_MAINTENANCE:'true'},
    {PRIVATE_VOICE_LAB_DATABASE_HOST:'production'}, {DATABASE_URL:'postgresql://synthetic@production/'+STAGING.databaseName},
    {DATABASE_URL:env().DATABASE_URL+'?host=production'}, {DATABASE_URL:env().DATABASE_URL+'#override'},
    {DATABASE_URL:env().DATABASE_URL.replace(host,host+':5433')},
    {PORTAL_STAGING_SETUP:'bookedradar-portal-staging-v1'}, {PORTAL_STAGING_SETUP:''},
    {DISPATCH_ENABLED:'true'}, {VOICE_ENABLED:'true'}, {DEMO_NUMBER_PROVISION_MODE:'on'}, {SEED_ON_STARTUP:'true'},
  ]) assert.throws(()=>ownerBindingCliConfig({...env(),...patch}));
});

test('owner binding refuses missing fingerprint or explicit reference before touching a pool',async()=>{
  const pool={query:()=>assert.fail('must not query'),connect:()=>assert.fail('must not connect')};
  for(const input of [{},{fingerprint:'a'.repeat(64)},{fingerprint:'garbage',confirmationReference:'owner confirmed'},
    {fingerprint:'a'.repeat(64),confirmationReference:'\nowner confirmed'},
    {fingerprint:'a'.repeat(64),confirmationReference:'x'.repeat(201)}]){
    await assert.rejects(activateStagingOwner({config:{enabled:true,...STAGING},pool,...input}),/explicit_fingerprint_confirmation_required/);
  }
});
