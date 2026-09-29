// Caller supplies existing admin and tenant authentication middleware. No
// provider calls, automatic resend, or unauthenticated store access live here.
export function mountReconciliationRoutes(app, { requireAdmin,requireTenant,storeForTenant }) {
  if (typeof requireAdmin!=='function' || typeof requireTenant!=='function' || typeof storeForTenant!=='function') throw new Error('reconciliation_auth_required');
  const storeFor=async(req,res)=>{
    const tenantId=req.bookedRadarTenant?.tenantId;
    if (!tenantId) {res.status(403).json({ok:false,error:'tenant_required'});return null;}
    const store=await storeForTenant(tenantId);
    if (!store || store.tenantId!==tenantId || typeof store.reconcileAction!=='function') {
      res.status(503).json({ok:false,error:'reconciliation_store_unavailable'});return null;
    }
    return store;
  };
  app.get('/api/v1/actions/reconciliation',requireAdmin,requireTenant,async(req,res)=>{
    try {
      const store=await storeFor(req,res);if(!store)return;
      res.json({ok:true,tenantId:store.tenantId,actions:await store.reconciliationActions()});
    } catch {res.status(503).json({ok:false,error:'reconciliation_query_failed'});}
  });
  app.post('/api/v1/actions/:id/reconcile',requireAdmin,requireTenant,async(req,res)=>{
    try {
      const store=await storeFor(req,res);if(!store)return;
      const {decision,expectedRevision,resolutionId,evidence}=req.body || {};
      const result=await store.reconcileAction(req.params.id,{decision,expectedRevision,resolutionId,evidence,actor:'authenticated_admin_api'});
      res.json({ok:true,...result});
    } catch (error) {
      const code=error?.message;
      if (code==='action_not_found') return res.status(404).json({ok:false,error:code});
      if (['stale_reconciliation_revision','reconciliation_id_conflict','dispatch_still_active'].includes(code)) return res.status(409).json({ok:false,error:code});
      if (['reconciliation_decision_invalid','reconciliation_id_invalid','reconciliation_revision_required','reconciliation_actor_required','reconciliation_evidence_required'].includes(code)) return res.status(400).json({ok:false,error:code});
      res.status(503).json({ok:false,error:'reconciliation_write_failed'});
    }
  });
}
