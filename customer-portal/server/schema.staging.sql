-- Applied only by explicitly approved staging-schema-setup.mjs after exact DB verification.
-- No grants, roles, credentials, source imports or automatic member bindings.
CREATE TABLE bookedradar_portal_staging.schema_version (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  version integer NOT NULL CHECK (version=1),
  origin text NOT NULL,
  client_id uuid NOT NULL,
  site_id uuid NOT NULL,
  migration_digest char(64) NOT NULL,
  catalog_digest char(64) NOT NULL
);
CREATE TABLE bookedradar_portal_staging.login_browsers (
  browser_hash bytea PRIMARY KEY CHECK (octet_length(browser_hash)=32),
  generation_hash bytea NOT NULL CHECK (octet_length(generation_hash)=32),
  revoked_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE bookedradar_portal_staging.oauth_flows (
  state_hash bytea PRIMARY KEY CHECK (octet_length(state_hash)=32),
  browser_hash bytea NOT NULL UNIQUE CHECK (octet_length(browser_hash)=32),
  code_verifier varchar(128),
  consumed_at timestamptz,
  CHECK ((consumed_at IS NULL AND code_verifier IS NOT NULL) OR (consumed_at IS NOT NULL AND code_verifier IS NULL)),
  FOREIGN KEY (browser_hash) REFERENCES bookedradar_portal_staging.login_browsers(browser_hash),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at timestamptz NOT NULL CHECK (expires_at>created_at AND expires_at<=created_at+INTERVAL '5 minutes')
);
CREATE INDEX oauth_flows_expiry ON bookedradar_portal_staging.oauth_flows(expires_at);
CREATE TABLE bookedradar_portal_staging.identity_bindings (
  fingerprint bytea PRIMARY KEY CHECK (octet_length(fingerprint)=32),
  tenant_id varchar(128) NOT NULL,
  member_id varchar(128) NOT NULL,
  user_id varchar(128) NOT NULL,
  active boolean NOT NULL DEFAULT false,
  FOREIGN KEY (tenant_id,member_id,user_id) REFERENCES bookedradar_portal_staging.memberships(tenant_id,id,user_id),
  UNIQUE (fingerprint,tenant_id,member_id,user_id)
);
CREATE TABLE bookedradar_portal_staging.login_discoveries (
  fingerprint bytea PRIMARY KEY CHECK (octet_length(fingerprint)=32),
  verified_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at timestamptz NOT NULL
);
ALTER TABLE bookedradar_portal_staging.sessions ADD COLUMN identity_fingerprint bytea NOT NULL;
ALTER TABLE bookedradar_portal_staging.sessions ADD CONSTRAINT sessions_verified_binding
  FOREIGN KEY (identity_fingerprint,tenant_id,member_id,user_id)
  REFERENCES bookedradar_portal_staging.identity_bindings(fingerprint,tenant_id,member_id,user_id);

ALTER TABLE bookedradar_portal_staging.sessions ADD COLUMN browser_hash bytea NOT NULL REFERENCES bookedradar_portal_staging.login_browsers(browser_hash);
ALTER TABLE bookedradar_portal_staging.sessions ADD COLUMN generation_hash bytea NOT NULL CHECK (octet_length(generation_hash)=32);

CREATE TABLE bookedradar_portal_staging.auth_rate_limits (
  bucket text PRIMARY KEY CHECK (bucket='login'),
  minute_started timestamptz NOT NULL,
  minute_attempts integer NOT NULL CHECK (minute_attempts BETWEEN 0 AND 10),
  hour_started timestamptz NOT NULL,
  hour_attempts integer NOT NULL CHECK (hour_attempts BETWEEN 0 AND 60)
);
CREATE TABLE bookedradar_portal_staging.identity_binding_audit (
  fingerprint bytea PRIMARY KEY REFERENCES bookedradar_portal_staging.identity_bindings(fingerprint),
  confirmation_reference varchar(200) NOT NULL,
  action text NOT NULL CHECK (action='owner_pilot_activated'),
  occurred_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
