import test from "node:test";
import assert from "node:assert/strict";
import {
  auditPostgresMigrationSnapshot,
  buildPostgresMigrationManifest,
} from "../src/postgres-migration-audit.js";

function validSnapshot() {
  const now = Date.now();
  return {
    state: {
      processedWebhooks: { "wh_1": now },
      calls: {
        "call_1": { tenantId: "demo-hvac", updatedAt: now, lastLead: { service_type: "repair" } },
      },
    },
    callHistory: {
      calls: {
        "call_1": {
          callId: "call_1",
          tenantId: "demo-hvac",
          startedAt: now - 1000,
          updatedAt: now,
          transcript: [
            { speaker: "caller", text: "My AC is warm", itemId: "i1", at: new Date(now - 900).toISOString() },
            { speaker: "assistant", text: "I can help.", itemId: "i2", at: new Date(now - 800).toISOString() },
          ],
        },
      },
    },
    leads: [{
      tenant_id: "demo-hvac",
      call_id: "call_1",
      name: "Synthetic Caller",
      service_type: "repair",
    }],
    recovery: {
      contacts: {
        "demo-hvac:+14095550101": {
          tenantId: "demo-hvac",
          contactKey: "demo-hvac:+14095550101",
          updatedAt: new Date(now).toISOString(),
        },
      },
      opportunities: {
        "opp_1": {
          id: "opp_1",
          tenantId: "demo-hvac",
          contactKey: "demo-hvac:+14095550101",
          status: "open",
          sourceEventId: "evt_1",
          createdAt: new Date(now - 700).toISOString(),
          updatedAt: new Date(now - 600).toISOString(),
        },
      },
      events: [{
        id: "evt_1",
        idempotencyKey: "phone-lead:demo-hvac:call_1",
        occurredAt: new Date(now - 700).toISOString(),
        type: "phone_lead",
      }],
      eventKeys: { "phone-lead:demo-hvac:call_1": "evt_1" },
      actions: {
        "act_1": {
          id: "act_1",
          tenantId: "demo-hvac",
          opportunityId: "opp_1",
          contactKey: "demo-hvac:+14095550101",
          channel: "human_task",
          status: "pending",
          dueAt: new Date(now + 1000).toISOString(),
          createdAt: new Date(now - 500).toISOString(),
        },
      },
      attribution: {
        "opp_1": {
          opportunityId: "opp_1",
          tenantId: "demo-hvac",
          confirmedRevenue: 0,
          updatedAt: new Date(now - 400).toISOString(),
        },
      },
    },
    webChat: {
      sessions: {
        "chat_1": {
          id: "chat_1",
          tenantId: "demo-hvac",
          opportunityId: "opp_1",
          createdAt: now - 300,
          updatedAt: now - 200,
          messages: [],
        },
      },
    },
    transfers: {
      calls: {
        "tr_1": {
          id: "tr_1",
          tenantId: "demo-hvac",
          callId: "call_1",
          status: "requested",
          updatedAt: now - 100,
        },
      },
    },
    growthMetrics: {
      counts: { "demo_call_click|hvac|email|default": 3 },
      updatedAt: new Date(now).toISOString(),
    },
    billingTest: { version: 1, mode: "test", accounts: {}, events: {} },
    billingLive: { version: 1, mode: "live", accounts: {}, events: {} },
  };
}

test("migration audit accepts a tenant-consistent snapshot and infers source-event tenant", () => {
  const audit = auditPostgresMigrationSnapshot(validSnapshot());
  assert.equal(audit.ok, true);
  assert.deepEqual(audit.errors, []);
  assert.equal(audit.warnings.length, 0);
  assert.equal(audit.counts.voiceCalls, 1);
  assert.equal(audit.counts.callTurns, 2);
  assert.equal(audit.counts.leads, 1);
  assert.equal(audit.counts.opportunities, 1);
  assert.match(audit.snapshotFingerprint, /^[a-f0-9]{64}$/);
});

test("migration manifest preserves all store categories and normalizes event tenant", () => {
  const manifest = buildPostgresMigrationManifest(validSnapshot());
  assert.equal(manifest.version, 1);
  assert.equal(manifest.rows.webhookReceipts.length, 1);
  assert.equal(manifest.rows.callControlState.length, 1);
  assert.equal(manifest.rows.voiceCalls.length, 1);
  assert.equal(manifest.rows.callTurns.length, 2);
  assert.equal(manifest.rows.leads.length, 1);
  assert.equal(manifest.rows.contacts.length, 1);
  assert.equal(manifest.rows.opportunities.length, 1);
  assert.equal(manifest.rows.recoveryEvents.length, 1);
  assert.equal(manifest.rows.recoveryEvents[0].tenantId, "demo-hvac");
  assert.equal(manifest.rows.recoveryActions.length, 1);
  assert.equal(manifest.rows.attribution.length, 1);
  assert.equal(manifest.rows.webChatSessions.length, 1);
  assert.equal(manifest.rows.transferRecords.length, 1);
  assert.equal(manifest.rows.growthMetrics.length, 1);
  assert.deepEqual(manifest.rows.billingState.map(x => x.mode).sort(), ["live", "test"]);
});

test("migration audit rejects cross-tenant opportunity/action relationships", () => {
  const snapshot = validSnapshot();
  snapshot.recovery.actions.act_1.tenantId = "demo-plumbing";
  const audit = auditPostgresMigrationSnapshot(snapshot);
  assert.equal(audit.ok, false);
  assert.ok(audit.errors.some(x => x.code === "action_cross_tenant_opportunity"));
  assert.ok(audit.errors.some(x => x.code === "action_cross_tenant_contact"));
  assert.throws(() => buildPostgresMigrationManifest(snapshot), /postgres_migration_snapshot_invalid/);
});

test("migration audit rejects call/lead tenant crossover", () => {
  const snapshot = validSnapshot();
  snapshot.leads[0].tenant_id = "demo-plumbing";
  snapshot.state.calls.call_1.tenantId = "demo-plumbing";
  const audit = auditPostgresMigrationSnapshot(snapshot);
  assert.equal(audit.ok, false);
  assert.ok(audit.errors.some(x => x.code === "lead_cross_tenant_call"));
  assert.ok(audit.errors.some(x => x.code === "call_state_cross_tenant_mismatch"));
});

test("migration audit hashes contact references instead of exposing phone/email keys", () => {
  const snapshot = validSnapshot();
  snapshot.recovery.contacts = {
    "+14095550101": {
      tenantId: "demo-hvac",
      updatedAt: new Date().toISOString(),
    },
  };
  const audit = auditPostgresMigrationSnapshot(snapshot);
  const finding = audit.errors.find(x => x.code === "contact_key_not_tenant_namespaced");
  assert.ok(finding);
  assert.match(finding.contactRef, /^[a-f0-9]{12}$/);
  assert.equal(JSON.stringify(finding).includes("+14095550101"), false);
});

test("migration audit allows legacy recovery events with unknown tenant only as a warning", () => {
  const snapshot = validSnapshot();
  snapshot.recovery.events.push({
    id: "evt_legacy",
    type: "legacy_event",
    occurredAt: new Date().toISOString(),
  });
  const audit = auditPostgresMigrationSnapshot(snapshot);
  assert.equal(audit.ok, true);
  assert.ok(audit.warnings.some(x =>
    x.code === "event_tenant_inferred_later_or_unknown" &&
    x.eventId === "evt_legacy"
  ));
});

test("migration audit rejects billing mode mismatch and invalid growth counts", () => {
  const snapshot = validSnapshot();
  snapshot.billingLive.mode = "test";
  snapshot.growthMetrics.counts.bad = -1;
  const audit = auditPostgresMigrationSnapshot(snapshot);
  assert.equal(audit.ok, false);
  assert.ok(audit.errors.some(x => x.code === "billing_live_mode_mismatch"));
  assert.ok(audit.errors.some(x => x.code === "growth_metric_invalid_count"));
});

test("migration fingerprint changes when source content changes even when counts do not", () => {
  const a = validSnapshot();
  const b = validSnapshot();
  b.recovery.opportunities.opp_1.status = "engaged";
  const auditA = auditPostgresMigrationSnapshot(a);
  const auditB = auditPostgresMigrationSnapshot(b);
  assert.notEqual(auditA.snapshotFingerprint, auditB.snapshotFingerprint);
});

test("migration manifest gives leads deterministic idempotent source keys", () => {
  const snapshot = validSnapshot();
  const first = buildPostgresMigrationManifest(snapshot);
  const second = buildPostgresMigrationManifest(snapshot);
  assert.match(first.rows.leads[0].sourceKey, /^[a-f0-9]{64}$/);
  assert.equal(first.rows.leads[0].sourceKey, second.rows.leads[0].sourceKey);
});

test("migration audit rejects duplicate recovery idempotency keys and key-map mismatches", () => {
  const snapshot = validSnapshot();
  snapshot.recovery.events.push({
    id: "evt_2",
    idempotencyKey: "phone-lead:demo-hvac:call_1",
    occurredAt: new Date().toISOString(),
    type: "phone_lead",
  });
  snapshot.recovery.eventKeys["phone-lead:demo-hvac:call_1"] = "evt_wrong";
  const audit = auditPostgresMigrationSnapshot(snapshot);
  assert.equal(audit.ok, false);
  assert.ok(audit.errors.some(x => x.code === "duplicate_event_idempotency_key"));
  assert.ok(audit.errors.some(x => x.code === "event_key_map_mismatch"));
  const serialized = JSON.stringify(audit.errors);
  assert.equal(serialized.includes("phone-lead:demo-hvac:call_1"), false);
});

test("migration manifest preserves recovery event sequence, eventKeys, and transfer webhook receipts", () => {
  const snapshot = validSnapshot();
  snapshot.recovery.events.unshift({
    id: "evt-z",
    tenantId: "demo-hvac",
    type: "manual_note",
    occurredAt: new Date(Date.now() - 1000).toISOString(),
  });
  snapshot.recovery.eventKeys["manual-key"] = "evt-z";
  snapshot.transfers.processedWebhooks = { "twilio-hook-1": Date.now() - 500 };

  const manifest = buildPostgresMigrationManifest(snapshot);
  assert.equal(manifest.rows.recoveryEvents[0].eventId, "evt-z");
  assert.equal(manifest.rows.recoveryEvents[0].sourceSequence, 0);
  assert.ok(manifest.rows.recoveryEventKeys.some(row =>
    row.eventKey === "manual-key" && row.eventId === "evt-z"
  ));
  assert.equal(manifest.rows.transferWebhookReceipts.length, 1);
  assert.equal(manifest.rows.transferWebhookReceipts[0].webhookId, "twilio-hook-1");
});

test("migration audit rejects eventKeys pointing to missing events and invalid transfer webhook timestamps", () => {
  const snapshot = validSnapshot();
  snapshot.recovery.eventKeys["bad-key"] = "missing-event";
  snapshot.transfers.processedWebhooks = { "bad-transfer-hook": 0 };
  const audit = auditPostgresMigrationSnapshot(snapshot);
  assert.equal(audit.ok, false);
  assert.ok(audit.errors.some(x => x.code === "event_key_unknown_event"));
  assert.ok(audit.errors.some(x => x.code === "transfer_webhook_invalid_timestamp"));
});
