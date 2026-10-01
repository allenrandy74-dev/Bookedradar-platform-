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

test('booking review requires admin and tenant ownership, hides errors and never writes',async()=>{
  const app=express();let reads=0;let input;
  const store={tenantId:'t1',async listBookingReview(options){reads++;input=options;return {attempts:[],nextAfterCallId:null};}};
  mountReconciliationRoutes(app,{
    requireAdmin:(req,res,next)=>req.headers.authorization==='Bearer synthetic' ? next() : res.sendStatus(401),
    requireTenant:(req,res,next)=>{req.bookedRadarTenant={tenantId:req.headers['x-tenant']};next();},
    storeForTenant:()=>null,bookingStoreForTenant:()=>store,
  });
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  const url=`http://127.0.0.1:${server.address().port}/api/v1/bookings/reconciliation`;
  const headers={authorization:'Bearer synthetic','x-tenant':'t1'};
  try {
    assert.equal((await fetch(url)).status,401);
    assert.equal((await fetch(url,{headers:{authorization:'Bearer synthetic'}})).status,403);
    assert.equal((await fetch(url,{headers:{...headers,'x-tenant':'t2'}})).status,503);
    assert.equal(reads,0);
    const success=await fetch(url+'?afterCallId=previous-call',{headers});
    assert.equal(success.status,200);assert.equal(success.headers.get('cache-control'),'no-store');
    assert.deepEqual(input,{afterCallId:'previous-call'});
    assert.equal((await success.json()).guardrail,'HUMAN_REVIEW_REQUIRED_NO_AUTOMATIC_RETRY');
    assert.equal((await fetch(url,{method:'POST',headers})).status,404);
    assert.equal(reads,1);
    store.listBookingReview=async()=>{throw new Error('booking_review_cursor_invalid');};
    assert.equal((await fetch(url,{headers})).status,400);
    store.listBookingReview=async()=>{throw new Error('private_database_error');};
    const failed=await fetch(url,{headers});assert.equal(failed.status,503);
    assert.equal((await failed.json()).error,'booking_review_query_failed');
  } finally {server.closeAllConnections();await new Promise(r=>server.close(r));}
});
