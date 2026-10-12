-- INACTIVE, REVIEWABLE MIGRATION. Do not apply to a production database without approval.
-- Creates only the isolated customer-portal schema. No grants, credentials, source-data
-- imports, application-route mounts, or changes to existing BookedRadar tables.
BEGIN;
CREATE SCHEMA bookedradar_portal;
REVOKE ALL ON SCHEMA bookedradar_portal FROM PUBLIC;

CREATE TABLE bookedradar_portal.tenants (
  id varchar(128) PRIMARY KEY CHECK (id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$'),
  name varchar(200) NOT NULL CHECK (length(name) > 0),
  active boolean NOT NULL DEFAULT false
);
CREATE TABLE bookedradar_portal.memberships (
  tenant_id varchar(128) NOT NULL REFERENCES bookedradar_portal.tenants(id),
  id varchar(128) NOT NULL CHECK (id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$'),
  user_id varchar(128) NOT NULL CHECK (user_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$'),
  name varchar(200) NOT NULL,
  role text NOT NULL CHECK (role IN ('viewer', 'operator')),
  active boolean NOT NULL DEFAULT false,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, id, user_id),
  UNIQUE (tenant_id, user_id)
);
CREATE TABLE bookedradar_portal.inquiries (
  tenant_id varchar(128) NOT NULL REFERENCES bookedradar_portal.tenants(id),
  id varchar(128) NOT NULL CHECK (id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$'),
  customer_name varchar(200) NOT NULL,
  contact_email varchar(320) NOT NULL DEFAULT '',
  contact_phone varchar(80) NOT NULL DEFAULT '',
  subject varchar(300) NOT NULL,
  summary varchar(4000) NOT NULL,
  source varchar(80) NOT NULL,
  received_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'in_progress', 'waiting', 'closed')),
  assignee_id varchar(128),
  version bigint NOT NULL DEFAULT 1 CHECK (version BETWEEN 1 AND 9007199254740991),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, assignee_id) REFERENCES bookedradar_portal.memberships(tenant_id, id)
);
CREATE INDEX inquiry_list_order ON bookedradar_portal.inquiries (tenant_id, received_at DESC, id);
CREATE TABLE bookedradar_portal.notes (
  tenant_id varchar(128) NOT NULL,
  inquiry_id varchar(128) NOT NULL,
  id varchar(128) NOT NULL CHECK (id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$'),
  author_id varchar(128) NOT NULL,
  text varchar(2000) NOT NULL CHECK (length(btrim(text)) > 0),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, inquiry_id) REFERENCES bookedradar_portal.inquiries(tenant_id, id),
  FOREIGN KEY (tenant_id, author_id) REFERENCES bookedradar_portal.memberships(tenant_id, id)
);
CREATE INDEX inquiry_notes_order ON bookedradar_portal.notes (tenant_id, inquiry_id, created_at, id);
CREATE TABLE bookedradar_portal.audit_events (
  tenant_id varchar(128) NOT NULL,
  inquiry_id varchar(128) NOT NULL,
  id varchar(128) NOT NULL CHECK (id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$'),
  actor_id varchar(128) NOT NULL,
  user_id varchar(128) NOT NULL,
  action text NOT NULL CHECK (action IN ('inquiry.updated', 'inquiry.note_added')),
  fields text[] NOT NULL CHECK (cardinality(fields) BETWEEN 1 AND 3 AND fields <@ ARRAY['status', 'assigneeId', 'note']::text[]),
  previous_version bigint NOT NULL CHECK (previous_version >= 1),
  version bigint NOT NULL CHECK (version = previous_version + 1 AND version <= 9007199254740991),
  occurred_at timestamptz NOT NULL,
  request_id uuid NOT NULL,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, inquiry_id, version),
  FOREIGN KEY (tenant_id, inquiry_id) REFERENCES bookedradar_portal.inquiries(tenant_id, id),
  FOREIGN KEY (tenant_id, actor_id, user_id) REFERENCES bookedradar_portal.memberships(tenant_id, id, user_id)
);
CREATE TABLE bookedradar_portal.sessions (
  -- SHA-256 of an approved identity flow's random 32-byte opaque cookie token.
  -- Raw session tokens and derived CSRF values are never stored here.
  token_hash bytea PRIMARY KEY CHECK (octet_length(token_hash) = 32),
  tenant_id varchar(128) NOT NULL,
  member_id varchar(128) NOT NULL,
  user_id varchar(128) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  CHECK (expires_at > created_at),
  FOREIGN KEY (tenant_id, member_id, user_id) REFERENCES bookedradar_portal.memberships(tenant_id, id, user_id)
);
CREATE INDEX sessions_membership ON bookedradar_portal.sessions (tenant_id, member_id);
CREATE INDEX sessions_expiry ON bookedradar_portal.sessions (expires_at);
-- Runtime role provisioning and minimal grants are intentionally not included.
COMMIT;
