import { assertStagingConfig, guardStagingPool } from './staging-config.mjs';
const hash = value => { if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw new Error('invalid_auth_hash'); return value; };
export function createStagingAuthStore({ pool, config } = {}) {
  assertStagingConfig(config); const db = guardStagingPool(pool, config);
  async function transaction(operation) {
    const client = await db.connect(); let broken=false,committing=false;
    try {
      await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
      await client.query("SET LOCAL lock_timeout='5s'"); await client.query("SET LOCAL statement_timeout='10s'");
      const result=await operation(client); committing=true;
      if((await client.query('COMMIT')).command!=='COMMIT')throw new Error('auth_transaction_not_committed');
      return result;
    }catch(error){if(committing)broken=true;try{await client.query('ROLLBACK');}catch{broken=true;}throw error;}
    finally{client.release(broken);}
  }
  async function invalidate(client,browserHash){
    await client.query('UPDATE bookedradar_portal_staging.login_browsers SET revoked_at=CURRENT_TIMESTAMP WHERE browser_hash=decode($1,\'hex\')',[browserHash]);
    await client.query('DELETE FROM bookedradar_portal_staging.oauth_flows WHERE browser_hash=decode($1,\'hex\')',[browserHash]);
  }
  return Object.freeze({
    async beginFlow({stateHash,browserHash,codeVerifier,previousSessionHash=null}){
      hash(stateHash);hash(browserHash);if(previousSessionHash)hash(previousSessionHash);
      if(typeof codeVerifier!=='string'||!/^[A-Za-z0-9_-]{43,128}$/.test(codeVerifier))throw new Error('invalid_pkce_verifier');
      return transaction(async client=>{
        await client.query(`INSERT INTO bookedradar_portal_staging.auth_rate_limits (bucket,minute_started,minute_attempts,hour_started,hour_attempts) VALUES ('login',CURRENT_TIMESTAMP,0,CURRENT_TIMESTAMP,0) ON CONFLICT(bucket) DO NOTHING`);
        const admission=await client.query(`UPDATE bookedradar_portal_staging.auth_rate_limits SET
          minute_attempts=CASE WHEN minute_started<=CURRENT_TIMESTAMP-INTERVAL '1 minute' THEN 1 ELSE minute_attempts+1 END,
          minute_started=CASE WHEN minute_started<=CURRENT_TIMESTAMP-INTERVAL '1 minute' THEN CURRENT_TIMESTAMP ELSE minute_started END,
          hour_attempts=CASE WHEN hour_started<=CURRENT_TIMESTAMP-INTERVAL '1 hour' THEN 1 ELSE hour_attempts+1 END,
          hour_started=CASE WHEN hour_started<=CURRENT_TIMESTAMP-INTERVAL '1 hour' THEN CURRENT_TIMESTAMP ELSE hour_started END
          WHERE bucket='login' AND (minute_attempts<10 OR minute_started<=CURRENT_TIMESTAMP-INTERVAL '1 minute') AND (hour_attempts<60 OR hour_started<=CURRENT_TIMESTAMP-INTERVAL '1 hour') RETURNING bucket`);
        if(admission.rowCount!==1)throw new Error('staging_auth_rate_limited');
        // Bounded cleanup touches only expired/revoked ephemeral staging auth rows.
        await client.query(`DELETE FROM bookedradar_portal_staging.sessions WHERE token_hash IN (SELECT token_hash FROM bookedradar_portal_staging.sessions WHERE expires_at<=CURRENT_TIMESTAMP OR revoked_at IS NOT NULL LIMIT 100)`);
        await client.query(`DELETE FROM bookedradar_portal_staging.login_discoveries WHERE fingerprint IN (SELECT fingerprint FROM bookedradar_portal_staging.login_discoveries WHERE expires_at<=CURRENT_TIMESTAMP LIMIT 100)`);
        await client.query(`DELETE FROM bookedradar_portal_staging.oauth_flows WHERE state_hash IN (SELECT state_hash FROM bookedradar_portal_staging.oauth_flows WHERE expires_at<=CURRENT_TIMESTAMP LIMIT 100)`);
        await client.query(`DELETE FROM bookedradar_portal_staging.login_browsers WHERE browser_hash IN (SELECT b.browser_hash FROM bookedradar_portal_staging.login_browsers b WHERE b.updated_at<CURRENT_TIMESTAMP-INTERVAL '31 minutes' AND NOT EXISTS (SELECT 1 FROM bookedradar_portal_staging.sessions se WHERE se.browser_hash=b.browser_hash) AND NOT EXISTS (SELECT 1 FROM bookedradar_portal_staging.oauth_flows f WHERE f.browser_hash=b.browser_hash) LIMIT 100)`);
        if(previousSessionHash){
          const previous=(await client.query('SELECT encode(browser_hash,\'hex\') AS browser_hash FROM bookedradar_portal_staging.sessions WHERE token_hash=decode($1,\'hex\')',[previousSessionHash])).rows[0];
          if(previous)await invalidate(client,previous.browser_hash);
          await client.query('UPDATE bookedradar_portal_staging.sessions SET revoked_at=CURRENT_TIMESTAMP WHERE token_hash=decode($1,\'hex\') AND revoked_at IS NULL',[previousSessionHash]);
        }
        // Replaces the durable generation before any provider request. Older
        // callbacks and even late Set-Cookie responses can no longer authorize.
        await client.query(`INSERT INTO bookedradar_portal_staging.login_browsers (browser_hash,generation_hash) VALUES (decode($1,'hex'),decode($2,'hex'))
          ON CONFLICT(browser_hash) DO UPDATE SET generation_hash=EXCLUDED.generation_hash,revoked_at=NULL,updated_at=CURRENT_TIMESTAMP`,[browserHash,stateHash]);
        await client.query('DELETE FROM bookedradar_portal_staging.oauth_flows WHERE browser_hash=decode($1,\'hex\')',[browserHash]);
        await client.query('INSERT INTO bookedradar_portal_staging.oauth_flows (state_hash,browser_hash,code_verifier,expires_at) VALUES (decode($1,\'hex\'),decode($2,\'hex\'),$3,CURRENT_TIMESTAMP+INTERVAL \'5 minutes\')',[stateHash,browserHash,codeVerifier]);
      });
    },
    async consumeFlow({stateHash,browserHash}){
      hash(stateHash);hash(browserHash);
      // Retain consumed intent while token verification is in flight. The verifier
      // is removed from storage, and only one caller obtains it through the CAS.
      const result=await db.query(`WITH pending AS (
        SELECT f.state_hash,f.code_verifier FROM bookedradar_portal_staging.oauth_flows f
        JOIN bookedradar_portal_staging.login_browsers b ON b.browser_hash=f.browser_hash AND b.generation_hash=f.state_hash AND b.revoked_at IS NULL
        WHERE f.state_hash=decode($1,'hex') AND f.browser_hash=decode($2,'hex') AND f.expires_at>clock_timestamp() AND f.consumed_at IS NULL FOR UPDATE OF f
      ) UPDATE bookedradar_portal_staging.oauth_flows f SET consumed_at=CURRENT_TIMESTAMP,code_verifier=NULL FROM pending p
        WHERE f.state_hash=p.state_hash RETURNING p.code_verifier`,[stateHash,browserHash]);
      return result.rows[0]?{codeVerifier:result.rows[0].code_verifier}:null;
    },
    async abandonFlow({stateHash,browserHash}){hash(stateHash);hash(browserHash);await db.query('DELETE FROM bookedradar_portal_staging.oauth_flows WHERE state_hash=decode($1,\'hex\') AND browser_hash=decode($2,\'hex\')',[stateHash,browserHash]);},
    async invalidateBrowser(browserHash){hash(browserHash);await transaction(client=>invalidate(client,browserHash));},
    async issueSession({fingerprint,tokenHash,expiresAt,stateHash,browserHash}){
      hash(fingerprint);hash(tokenHash);hash(stateHash);hash(browserHash);
      if(!Number.isFinite(Date.parse(expiresAt)))throw new Error('invalid_session_expiry');
      return transaction(async client=>{
        const browser=(await client.query(`SELECT browser_hash FROM bookedradar_portal_staging.login_browsers WHERE browser_hash=decode($1,'hex') AND generation_hash=decode($2,'hex') AND revoked_at IS NULL FOR SHARE`,[browserHash,stateHash])).rows[0];
        if(!browser)return {kind:'invalid_flow'};
        const intent=await client.query(`DELETE FROM bookedradar_portal_staging.oauth_flows WHERE state_hash=decode($1,'hex') AND browser_hash=decode($2,'hex') AND consumed_at IS NOT NULL AND expires_at>clock_timestamp() RETURNING state_hash`,[stateHash,browserHash]);
        if(intent.rowCount!==1)return {kind:'invalid_flow'};
        const binding=(await client.query(`SELECT b.tenant_id,b.member_id,b.user_id FROM bookedradar_portal_staging.identity_bindings b
          JOIN bookedradar_portal_staging.memberships m ON m.tenant_id=b.tenant_id AND m.id=b.member_id AND m.user_id=b.user_id
          JOIN bookedradar_portal_staging.tenants t ON t.id=b.tenant_id
          WHERE b.fingerprint=decode($1,'hex') AND b.active=true AND m.active=true AND t.active=true FOR SHARE OF b,m,t`,[fingerprint])).rows[0];
        if(!binding){
          await client.query(`INSERT INTO bookedradar_portal_staging.login_discoveries (fingerprint,expires_at) VALUES (decode($1,'hex'),CURRENT_TIMESTAMP+INTERVAL '15 minutes')
            ON CONFLICT(fingerprint) DO UPDATE SET verified_at=CURRENT_TIMESTAMP,expires_at=EXCLUDED.expires_at`,[fingerprint]);
          return {kind:'binding_required'};
        }
        await client.query(`INSERT INTO bookedradar_portal_staging.sessions (token_hash,tenant_id,member_id,user_id,expires_at,identity_fingerprint,browser_hash,generation_hash)
          VALUES (decode($1,'hex'),$2,$3,$4,LEAST($5::timestamptz,CURRENT_TIMESTAMP+INTERVAL '30 minutes'),decode($6,'hex'),decode($7,'hex'),decode($8,'hex'))`,[tokenHash,binding.tenant_id,binding.member_id,binding.user_id,expiresAt,fingerprint,browserHash,stateHash]);
        return {kind:'issued'};
      });
    },
    async revokeSession(tokenHash){
      hash(tokenHash);return transaction(async client=>{
        const previous=(await client.query('SELECT encode(browser_hash,\'hex\') AS browser_hash FROM bookedradar_portal_staging.sessions WHERE token_hash=decode($1,\'hex\')',[tokenHash])).rows[0];
        if(previous)await invalidate(client,previous.browser_hash);
        await client.query('UPDATE bookedradar_portal_staging.sessions SET revoked_at=CURRENT_TIMESTAMP WHERE token_hash=decode($1,\'hex\') AND revoked_at IS NULL',[tokenHash]);
      });
    },
    async rotateSession({previousHash,nextHash}){
      hash(previousHash);hash(nextHash);
      return transaction(async client=>{
        const browserLock=await client.query(`SELECT br.browser_hash FROM bookedradar_portal_staging.login_browsers br JOIN bookedradar_portal_staging.sessions se ON se.browser_hash=br.browser_hash AND se.generation_hash=br.generation_hash WHERE se.token_hash=decode($1,'hex') AND br.revoked_at IS NULL FOR SHARE OF br`,[previousHash]);
        if(browserLock.rowCount!==1)return null;
        const row=(await client.query(`SELECT se.tenant_id,se.member_id,se.user_id,se.expires_at,encode(se.identity_fingerprint,'hex') AS fingerprint,encode(se.browser_hash,'hex') AS browser_hash,encode(se.generation_hash,'hex') AS generation_hash
          FROM bookedradar_portal_staging.sessions se
          JOIN bookedradar_portal_staging.login_browsers br ON br.browser_hash=se.browser_hash AND br.generation_hash=se.generation_hash AND br.revoked_at IS NULL
          JOIN bookedradar_portal_staging.identity_bindings b ON b.fingerprint=se.identity_fingerprint AND b.tenant_id=se.tenant_id AND b.member_id=se.member_id AND b.user_id=se.user_id
          JOIN bookedradar_portal_staging.memberships m ON m.tenant_id=se.tenant_id AND m.id=se.member_id AND m.user_id=se.user_id
          JOIN bookedradar_portal_staging.tenants t ON t.id=se.tenant_id
          WHERE se.token_hash=decode($1,'hex') AND se.revoked_at IS NULL AND se.expires_at>clock_timestamp() AND b.active=true AND m.active=true AND t.active=true
          FOR UPDATE OF se FOR SHARE OF br,b,m,t`,[previousHash])).rows[0];
        if(!row)return null;
        await client.query('UPDATE bookedradar_portal_staging.sessions SET revoked_at=CURRENT_TIMESTAMP WHERE token_hash=decode($1,\'hex\')',[previousHash]);
        await client.query(`INSERT INTO bookedradar_portal_staging.sessions (token_hash,tenant_id,member_id,user_id,expires_at,identity_fingerprint,browser_hash,generation_hash)
          VALUES (decode($1,'hex'),$2,$3,$4,$5,decode($6,'hex'),decode($7,'hex'),decode($8,'hex'))`,[nextHash,row.tenant_id,row.member_id,row.user_id,row.expires_at,row.fingerprint,row.browser_hash,row.generation_hash]);
        return {expiresAt:new Date(row.expires_at).toISOString()};
      });
    },
  });
}
