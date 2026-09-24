import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { RecoveryStore } from "../src/recovery/store.js";
import { RecoveryEngine } from "../src/recovery/engine.js";
import { radarProof } from "../src/recovery/radarproof.js";

function tenant() {
  return {
    tenantId: "t1",
    businessName: "Test HVAC",
    trade: "HVAC",
    timeZone: "America/Chicago",
    serviceArea: ["Test"],
    escalation: { humanPhone: "+14095550100" },
    policies: {
      bookingMode: "confirm_only",
      quietHours: { start: 20, end: 8 },
      sms: { allowTransactionalWhenInbound: true },
    },
    economics: {
      defaultAverageJobValue: 500,
      averageJobValueByType: { replacement: 10000 },
    },
  };
}

async function makeEngine() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "br-recovery-"));
  const store = new RecoveryStore(path.join(dir, "state.json"));
  await store.load();
  return { store, engine: new RecoveryEngine({ store, tenant: tenant() }) };
}

test("missed call creates opportunity and recovery sequence", async () => {
  const { engine } = await makeEngine();
  const result = await engine.ingest({
    type: "missed_call",
    serviceType: "repair",
    contact: {
      name: "Sam",
      phone: "+14095550111",
      transactionalSmsAllowed: true,
    },
  });

  assert.equal(result.opportunity.type, "missed_call");
  assert.ok(result.actions.length >= 3);
  assert.ok(result.actions.some((a) => a.channel === "sms"));
});

test("dormant marketing email is blocked without marketing consent", async () => {
  const { engine } = await makeEngine();
  const result = await engine.ingest({
    type: "customer_dormant",
    contact: { name: "Jordan", email: "j@example.com" },
  });

  const marketing = result.actions.filter((a) => a.purpose === "marketing");
  // Production v2.2 routes non-consenting contacts to human review instead
  // of creating a blocked marketing action. Both paths must prevent sending.
  assert.ok(marketing.length || result.actions.some(a => a.channel === "human_task"));
  for (const action of marketing) {
    assert.equal(action.status, "blocked");
    assert.equal(action.blockedReason, "marketing_consent_required");
  }
});

test("confirmed revenue stays separate from estimated value", async () => {
  const { store, engine } = await makeEngine();
  const created = await engine.ingest({
    type: "estimate_sent",
    estimateAmount: 12000,
    contact: { name: "Alex", email: "a@example.com" },
  });

  await engine.markRecovered(created.opportunity.id, { bookingId: "b1" });
  await engine.ingest({
    type: "revenue_confirmed",
    opportunityId: created.opportunity.id,
    amount: 11850,
  });

  const report = await radarProof(store);
  assert.equal(report.estimatedOpportunityValue, 12000);
  assert.equal(report.confirmedRevenue, 11850);
  assert.equal(report.recoveredOpportunities, 1);
});


test("answered phone lead schedules review and follow-up instead of web-lead flow", async () => {
  const { engine } = await makeEngine();
  const result = await engine.ingest({
    type: "phone_lead",
    serviceType: "repair",
    contact: {
      name: "Pat",
      phone: "+14095550112",
      transactionalSmsAllowed: true,
    },
  });

  assert.ok(result.actions.some((a) => a.channel === "human_task"));
  assert.ok(result.actions.some((a) => a.template === "phone_lead_followup"));
  assert.equal(result.actions.some((a) => a.template === "web_lead_ack"), false);
});


test("optional growth automation is feature-gated", async () => {
  const { engine } = await makeEngine();
  const membership=await engine.ingest({
    idempotencyKey:"m",
    type:"membership_renewal_due",
    contact:{name:"Alex",email:"a@example.com"},
    metadata:{membershipId:"m1",renewalDate:"2026-10-01"}
  });
  assert.ok(membership.actions.some(a=>a.template==="membership_renewal_review"));
  assert.equal(membership.actions.some(a=>a.template==="membership_renewal_notice"),false);

  const reminder=await engine.ingest({
    idempotencyKey:"r",
    type:"appointment_reminder_due",
    contact:{name:"Alex",phone:"+14095550100",transactionalSmsAllowed:true},
    metadata:{appointmentId:"a1",scheduledFor:"2026-09-25T14:00:00Z"}
  });
  assert.ok(reminder.actions.some(a=>a.template==="appointment_reminder_review"));
  assert.equal(reminder.actions.some(a=>a.template==="appointment_reminder"),false);
});

test("enabled no-show guard can schedule approved transactional reminder", async () => {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),"br-recovery-feature-"));
  const store=new RecoveryStore(path.join(dir,"state.json"));await store.load();
  const configured=tenant(); configured.features={noShowGuard:true};
  const engine=new RecoveryEngine({store,tenant:configured});
  const reminder=await engine.ingest({
    idempotencyKey:"r2",
    type:"appointment_reminder_due",
    contact:{name:"Alex",phone:"+14095550100",transactionalSmsAllowed:true},
    metadata:{appointmentId:"a2",scheduledFor:"2026-09-25T14:00:00Z"}
  });
  assert.ok(reminder.actions.some(a=>a.template==="appointment_reminder" && a.channel==="sms"));
});
