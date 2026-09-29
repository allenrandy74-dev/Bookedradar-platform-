import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { mountReconciliationRoutes } from '../src/recovery/reconciliation-http.js';

test('reconciliation routes enforce authentication, scope and fixed audit actor',async()=>{
  const app=express();app.use(express.json());let reads=0;let resolved;
  const store={tenantId:'t1',reconciliationActions:async()=>{reads++;return [];},reconcileAction:async(id,input)=>{resolved={id,...input};return {action:{id,status:'completed'},duplicate:false};}};
  mountReconciliationRoutes(app,{
    requireAdmin:(req,res,next)=>req.headers.authorization==='Bearer synthetic' ? next() : res.sendStatus(401),
    requireTenant:(req,res,next)=>{req.bookedRadarTenant={tenantId:req.headers['x-tenant']};next();},
    storeForTenant:()=>store,
  });
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  const base=`http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await fetch(base+'/api/v1/actions/reconciliation')).status,401);assert.equal(reads,0);
    assert.equal((await fetch(base+'/api/v1/actions/reconciliation',{headers:{authorization:'Bearer synthetic','x-tenant':'t2'}})).status,503);assert.equal(reads,0);
    assert.equal((await fetch(base+'/api/v1/actions/reconciliation',{headers:{authorization:'Bearer synthetic','x-tenant':'t1'}})).status,200);assert.equal(reads,1);
    const response=await fetch(base+'/api/v1/actions/a/reconcile',{method:'POST',headers:{authorization:'Bearer synthetic','x-tenant':'t1','content-type':'application/json'},body:JSON.stringify({decision:'confirmed_sent',resolutionId:'resolution1',expectedRevision:'a'.repeat(64),evidence:'Synthetic provider lookup',actor:'forged-owner'})});
    assert.equal(response.status,200);assert.equal(resolved.actor,'authenticated_admin_api');
    store.reconcileAction=async()=>{throw new Error('stale_reconciliation_revision');};
    assert.equal((await fetch(base+'/api/v1/actions/a/reconcile',{method:'POST',headers:{authorization:'Bearer synthetic','x-tenant':'t1'}})).status,409);
    store.reconcileAction=async()=>{throw new Error('database_password_must_not_be_returned');};
    const failed=await fetch(base+'/api/v1/actions/a/reconcile',{method:'POST',headers:{authorization:'Bearer synthetic','x-tenant':'t1'}});
    assert.equal(failed.status,503);assert.equal((await failed.json()).error,'reconciliation_write_failed');
  } finally {server.closeAllConnections();await new Promise(r=>server.close(r));}
});
