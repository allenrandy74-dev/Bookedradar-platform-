import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { useJsonMemoryView } from "../src/json-file-transaction.js";
import { CallHistoryStore } from "../src/call-history.js";

test("call history is tenant-isolated, searchable and redacts obvious sensitive numbers", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "br-call-history-"));
  const store = new CallHistoryStore(path.join(dir, "calls.json"));
  await store.start("call-a", { tenantId: "a", callerMasked: "***0100" });
  await store.addTurn("call-a", { speaker: "caller", text: "My AC is out and my SSN is 123-45-6789" });
  await store.addTurn("call-a", { speaker: "assistant", text: "I can help with the AC request." });
  await store.start("call-b", { tenantId: "b", callerMasked: "***0200" });
  assert.equal((await store.list("a", { q: "AC" })).length, 1);
  assert.equal((await store.list("b", { q: "AC" })).length, 0);
  const call = await store.get("a", "call-a");
  assert.match(call.transcript[0].text, /REDACTED_SSN/);
  assert.doesNotMatch(call.transcript[0].text, /123-45-6789/);
  assert.equal(await store.get("b", "call-a"), null);
});


test('pilot history window excludes exact end and later calls from every numerator',async()=>{
 const store=useJsonMemoryView(new CallHistoryStore('/unused'));
 store.data.calls={before:{tenantId:'t',startedAt:99,transferred:true},inside:{tenantId:'t',startedAt:100,transferred:true,leadSummary:{serviceType:'repair',callback:'***',urgency:'routine',preferredWindow:'tomorrow'}},end:{tenantId:'t',startedAt:200,transferred:true},other:{tenantId:'other',startedAt:150,transferred:true}};
 const result=await store.statsSince('t',100,200);
 assert.equal(result.callsHandled,1);assert.equal(result.humanTransfers,1);assert.equal(result.incompleteCalls,0);assert.equal(result.firstUsefulLeadAt,100);
});
