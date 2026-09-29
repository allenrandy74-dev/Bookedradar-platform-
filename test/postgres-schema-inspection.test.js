import test from "node:test";
import assert from "node:assert/strict";
import {
  EXPECTED_TABLES,
  inspectPostgresSchema,
  runStartupPostgresSchemaInspection,
} from "../src/postgres-schema-inspection.js";

test("schema inspection reads metadata only inside repeatable-read transaction", async () => {
  const queries=[];
  let released=false;
  const client={
    async query(sql){
      const text=String(sql);
      queries.push(text);
      if(text==="BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY") return {rows:[]};
      if(text==="COMMIT") return {rows:[]};
      if(text.includes("information_schema.columns")) {
        return {rows:[
          {table_name:"call_turns",column_name:"call_id",data_type:"text",is_nullable:"NO",column_default:null,ordinal_position:1},
          {table_name:"call_turns",column_name:"sequence",data_type:"integer",is_nullable:"NO",column_default:null,ordinal_position:2},
        ]};
      }
      if(text.includes("information_schema.table_constraints")) {
        return {rows:[
          {table_name:"call_turns",constraint_name:"call_turns_pkey",constraint_type:"PRIMARY KEY",column_name:"call_id",ordinal_position:1},
          {table_name:"call_turns",constraint_name:"call_turns_pkey",constraint_type:"PRIMARY KEY",column_name:"sequence",ordinal_position:2},
        ]};
      }
      throw new Error("unexpected_query");
    },
    release(){released=true;},
  };
  const pool={async connect(){return client;}};
  const result=await inspectPostgresSchema(pool);
  assert.equal(result.ok,true);
  assert.equal(result.schema,"bookedradar");
  assert.deepEqual(result.tables.call_turns.columns.map(x=>x.name),["call_id","sequence"]);
  assert.deepEqual(result.tables.call_turns.constraints[0].columns,["call_id","sequence"]);
  assert.ok(result.missingTables.includes("voice_calls"));
  assert.equal(released,true);
  assert.equal(queries[0],"BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  assert.equal(queries.at(-1),"COMMIT");
  assert.equal(queries.some(q=>/\b(?:INSERT|UPDATE|DELETE|ALTER|DROP|CREATE)\b/i.test(q)),false);
});

test("startup schema inspection is inert when disabled", async () => {
  let connected=false;
  const result=await runStartupPostgresSchemaInspection({
    enabled:false,
    createPool(){connected=true;throw new Error("should_not_run");},
  });
  assert.deepEqual(result,{enabled:false,status:"disabled"});
  assert.equal(connected,false);
});

test("startup schema inspection reports safe metadata and closes pool", async () => {
  const secret="postgresql://user:secret-password@internal/db";
  let ended=false;
  const logs=[];
  const pool={async end(){ended=true;}};
  const result=await runStartupPostgresSchemaInspection({
    enabled:true,
    env:{DATABASE_URL:secret},
    createPool(config){
      assert.equal(config.connectionString,secret);
      return pool;
    },
    inspect:async()=>({
      ok:true,
      schema:"bookedradar",
      tableCount:1,
      expectedTableCount:EXPECTED_TABLES.length,
      missingTables:["call_turns"],
      unexpectedTableCount:0,
      tables:{
        voice_calls:{
          columns:[{name:"call_id",type:"text",nullable:false,hasDefault:false,position:1}],
          constraints:[],
        },
      },
    }),
    log:(event,fields)=>logs.push({event,...fields}),
  });
  assert.equal(result.status,"complete");
  assert.equal(result.ok,true);
  assert.equal(ended,true);
  assert.equal(JSON.stringify(result).includes("secret-password"),false);
  assert.equal(JSON.stringify(logs).includes("secret-password"),false);
  assert.equal(logs[0].event,"postgres.schema_inspection");
});

test("schema inspection rolls back on metadata query failure", async () => {
  const queries=[];
  let released=false;
  const client={
    async query(sql){
      const text=String(sql); queries.push(text);
      if(text==="BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY") return {rows:[]};
      if(text==="ROLLBACK") return {rows:[]};
      throw new Error("metadata_failed");
    },
    release(){released=true;},
  };
  await assert.rejects(
    inspectPostgresSchema({async connect(){return client;}}),
    /metadata_failed/
  );
  assert.equal(queries.at(-1),"ROLLBACK");
  assert.equal(released,true);
});
