// Existing adapters own their own transactions. Within this unit of work those
// boundaries become savepoints, so no adapter can commit a partial workflow.
export async function postgresUnitOfWork(pool,tenantId,fn) {
  const client=await pool.connect();let sequence=0;let busy=false;
  const scoped={requiresOuterCommit:true,query:(...args)=>client.query(...args),connect:async()=>{
    if(busy)throw new Error('parallel_nested_transaction_forbidden');busy=true;
    const savepoint=`workflow_${++sequence}`;let begun=false;
    return {query:async(sql,values)=>{
      if(String(sql).startsWith('BEGIN')){await client.query(`SAVEPOINT ${savepoint}`);begun=true;return {rows:[]};}
      if(sql==='COMMIT'){await client.query(`RELEASE SAVEPOINT ${savepoint}`);begun=false;return {rows:[]};}
      if(sql==='ROLLBACK'){if(begun){await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);await client.query(`RELEASE SAVEPOINT ${savepoint}`);begun=false;}return {rows:[]};}
      return client.query(sql,values);
    },release(){busy=false;}};
  }};
  try {
    await client.query('BEGIN');await client.query("SET LOCAL lock_timeout='5s'");await client.query("SET LOCAL statement_timeout='15s'");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('br_recovery'),hashtext($1))",[tenantId]);
    const result=await fn(scoped);if(busy)throw new Error('nested_transaction_not_released');await client.query('COMMIT');return result;
  }catch(error){try{await client.query('ROLLBACK');}catch{}throw error;}finally{client.release();}
}
