-- BookedRadar managed Postgres foundation
-- This schema is not yet wired to production. It is designed for a staged,
-- reversible migration from the current single-instance JSON/JSONL stores.

CREATE SCHEMA IF NOT EXISTS bookedradar;

CREATE TABLE IF NOT EXISTS bookedradar.webhook_receipts (
  webhook_id text PRIMARY KEY,
  received_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS bookedradar.call_control_state (
  call_id text PRIMARY KEY,
  tenant_id text,
  updated_at timestamptz NOT NULL,
  payload jsonb NOT NULL
);

CREATE INDEX IF NOT EXISTS call_control_state_tenant_updated_idx
  ON bookedradar.call_control_state (tenant_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS bookedradar.voice_calls (
  call_id text PRIMARY KEY,
  tenant_id text NOT NULL,
  caller_masked text,
  dialed_masked text,
  started_at timestamptz,
  ended_at timestamptz,
  updated_at timestamptz NOT NULL,
  transferred boolean NOT NULL DEFAULT false,
  spam_ended boolean NOT NULL DEFAULT false,
  payload jsonb NOT NULL
);

CREATE INDEX IF NOT EXISTS voice_calls_tenant_started_idx
  ON bookedradar.voice_calls (tenant_id, started_at DESC);
CREATE INDEX IF NOT EXISTS voice_calls_updated_idx
  ON bookedradar.voice_calls (updated_at DESC);

CREATE TABLE IF NOT EXISTS bookedradar.call_turns (
  call_id text NOT NULL REFERENCES bookedradar.voice_calls(call_id) ON DELETE CASCADE,
  sequence_no integer NOT NULL,
  speaker text NOT NULL CHECK (speaker IN ('caller','assistant')),
  item_id text,
  occurred_at timestamptz,
  text_content text NOT NULL,
  PRIMARY KEY (call_id, sequence_no)
);

CREATE INDEX IF NOT EXISTS call_turns_call_time_idx
  ON bookedradar.call_turns (call_id, occurred_at);

CREATE TABLE IF NOT EXISTS bookedradar.lead_captures (
  lead_id bigserial PRIMARY KEY,
  source_key text NOT NULL UNIQUE,
  tenant_id text NOT NULL,
  call_id text,
  captured_at timestamptz,
  payload jsonb NOT NULL
);

CREATE INDEX IF NOT EXISTS lead_captures_tenant_time_idx
  ON bookedradar.lead_captures (tenant_id, captured_at DESC);
CREATE INDEX IF NOT EXISTS lead_captures_call_idx
  ON bookedradar.lead_captures (call_id);

CREATE TABLE IF NOT EXISTS bookedradar.recovery_contacts (
  contact_key text PRIMARY KEY,
  tenant_id text NOT NULL,
  updated_at timestamptz,
  payload jsonb NOT NULL
);

CREATE INDEX IF NOT EXISTS recovery_contacts_tenant_idx
  ON bookedradar.recovery_contacts (tenant_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS bookedradar.recovery_opportunities (
  opportunity_id text PRIMARY KEY,
  tenant_id text NOT NULL,
  contact_key text,
  status text NOT NULL,
  created_at timestamptz,
  updated_at timestamptz,
  payload jsonb NOT NULL
);

CREATE INDEX IF NOT EXISTS recovery_opportunities_tenant_status_idx
  ON bookedradar.recovery_opportunities (tenant_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS recovery_opportunities_contact_idx
  ON bookedradar.recovery_opportunities (tenant_id, contact_key);

CREATE SEQUENCE IF NOT EXISTS bookedradar.recovery_event_sequence;

CREATE TABLE IF NOT EXISTS bookedradar.recovery_events (
  event_id text PRIMARY KEY,
  source_sequence bigint DEFAULT nextval('bookedradar.recovery_event_sequence'),
  tenant_id text,
  idempotency_key text,
  opportunity_id text,
  contact_key text,
  occurred_at timestamptz NOT NULL,
  payload jsonb NOT NULL,
  UNIQUE (tenant_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS recovery_events_tenant_time_idx
  ON bookedradar.recovery_events (tenant_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS recovery_events_opportunity_idx
  ON bookedradar.recovery_events (opportunity_id, occurred_at DESC);


ALTER TABLE bookedradar.recovery_events
  ADD COLUMN IF NOT EXISTS source_sequence bigint;
ALTER TABLE bookedradar.recovery_events
  ALTER COLUMN source_sequence SET DEFAULT nextval('bookedradar.recovery_event_sequence');

CREATE INDEX IF NOT EXISTS recovery_events_sequence_idx
  ON bookedradar.recovery_events (source_sequence);

CREATE TABLE IF NOT EXISTS bookedradar.recovery_event_keys (
  tenant_id text NOT NULL,
  event_key text NOT NULL,
  event_id text NOT NULL,
  PRIMARY KEY (tenant_id, event_key)
);

CREATE INDEX IF NOT EXISTS recovery_event_keys_event_idx
  ON bookedradar.recovery_event_keys (event_id);

CREATE TABLE IF NOT EXISTS bookedradar.recovery_actions (
  action_id text PRIMARY KEY,
  tenant_id text NOT NULL,
  opportunity_id text,
  contact_key text,
  channel text,
  status text NOT NULL,
  due_at timestamptz,
  claimed_by text,
  claimed_at timestamptz,
  claim_expires_at timestamptz,
  created_at timestamptz,
  completed_at timestamptz,
  payload jsonb NOT NULL
);

CREATE INDEX IF NOT EXISTS recovery_actions_due_idx
  ON bookedradar.recovery_actions (status, due_at);
CREATE INDEX IF NOT EXISTS recovery_actions_tenant_status_idx
  ON bookedradar.recovery_actions (tenant_id, status, due_at);
CREATE INDEX IF NOT EXISTS recovery_actions_opportunity_idx
  ON bookedradar.recovery_actions (opportunity_id);

CREATE TABLE IF NOT EXISTS bookedradar.recovery_attribution (
  opportunity_id text PRIMARY KEY,
  tenant_id text NOT NULL,
  updated_at timestamptz,
  payload jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS bookedradar.web_chat_sessions (
  session_id text PRIMARY KEY,
  tenant_id text NOT NULL,
  opportunity_id text,
  created_at timestamptz,
  updated_at timestamptz NOT NULL,
  payload jsonb NOT NULL
);

CREATE INDEX IF NOT EXISTS web_chat_sessions_tenant_updated_idx
  ON bookedradar.web_chat_sessions (tenant_id, updated_at DESC);

-- Preserve provider handoff state without forcing it into the customer-domain
-- tables during the first migration.
CREATE TABLE IF NOT EXISTS bookedradar.transfer_records (
  transfer_id text PRIMARY KEY,
  tenant_id text,
  call_id text,
  status text,
  updated_at timestamptz,
  payload jsonb NOT NULL
);

CREATE INDEX IF NOT EXISTS transfer_records_call_idx
  ON bookedradar.transfer_records (call_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS bookedradar.transfer_webhook_receipts (
  webhook_id text PRIMARY KEY,
  received_at timestamptz NOT NULL
);

-- Stripe remains authoritative for Stripe objects. This table preserves only
-- BookedRadar's local orchestration state during the first cutover.
CREATE TABLE IF NOT EXISTS bookedradar.billing_state (
  mode text PRIMARY KEY CHECK (mode IN ('test','live')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  payload jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS bookedradar.growth_metrics (
  metric_key text PRIMARY KEY,
  metric_count bigint NOT NULL CHECK (metric_count >= 0),
  updated_at timestamptz,
  payload jsonb NOT NULL
);


CREATE TABLE IF NOT EXISTS bookedradar.ops_incidents (
  incident_key text PRIMARY KEY,
  scope_key text NOT NULL,
  severity text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  last_notified_at timestamptz,
  resolved_at timestamptz,
  occurrences bigint NOT NULL DEFAULT 1,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS ops_incidents_scope_status_idx
  ON bookedradar.ops_incidents (scope_key, status, last_seen_at DESC);

CREATE TABLE IF NOT EXISTS bookedradar.ops_notifications (
  notification_id text PRIMARY KEY,
  incident_key text NOT NULL REFERENCES bookedradar.ops_incidents(incident_key),
  state text NOT NULL CHECK (state IN ('pending','accepted','uncertain','not_sent')),
  created_at timestamptz NOT NULL DEFAULT now(),
  provider_receipt text,
  payload jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS ops_notifications_incident_created_idx
  ON bookedradar.ops_notifications (incident_key,created_at DESC);

CREATE TABLE IF NOT EXISTS bookedradar.migration_runs (
  migration_id text PRIMARY KEY,
  source_snapshot_sha256 text NOT NULL,
  started_at timestamptz NOT NULL,
  completed_at timestamptz,
  status text NOT NULL,
  counts jsonb NOT NULL,
  validation jsonb NOT NULL
);

-- Permanent provider intent/receipt authority. No TTL, cascade or automatic prune.
-- A pending/unknown intent must never be silently reclaimed after a crash.
CREATE TABLE IF NOT EXISTS bookedradar.provider_attempt_receipts (
  attempt_key text PRIMARY KEY,
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object')
);

-- Upgrade legacy global event-key uniqueness to tenant-scoped uniqueness.
ALTER TABLE bookedradar.recovery_events DROP CONSTRAINT IF EXISTS recovery_events_idempotency_key_key;
CREATE UNIQUE INDEX IF NOT EXISTS recovery_events_tenant_idempotency_idx
  ON bookedradar.recovery_events (tenant_id,idempotency_key);
