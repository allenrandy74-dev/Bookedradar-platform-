-- INACTIVE CANDIDATE. Never executed by startup, staging setup, or this library.
-- Separate approval is required to apply this migration and to enable any source
-- read/import. Apply only after the existing portal schema in the SAME database
-- as the recovery source. No grants, roles, source alterations, or source writes.
BEGIN;
CREATE TABLE bookedradar_portal.source_links (
  tenant_id varchar(128) NOT NULL,
  inquiry_id varchar(128) NOT NULL,
  source_kind text NOT NULL CHECK (source_kind='recovery'),
  source_opportunity_id varchar(128) NOT NULL CHECK (source_opportunity_id=inquiry_id),
  source_contact_key varchar(512) NOT NULL CHECK (length(source_contact_key)>length(tenant_id)+1 AND left(source_contact_key,length(tenant_id)+1)=tenant_id||':'),
  source_event_id varchar(512) NOT NULL CHECK (length(source_event_id)>0),
  source_fingerprint char(64) NOT NULL CHECK (source_fingerprint ~ '^[a-f0-9]{64}$'),
  first_imported_at timestamptz NOT NULL,
  last_observed_at timestamptz NOT NULL CHECK (last_observed_at>=first_imported_at),
  PRIMARY KEY (tenant_id,inquiry_id),
  UNIQUE (tenant_id,source_kind,source_opportunity_id),
  FOREIGN KEY (tenant_id,inquiry_id) REFERENCES bookedradar_portal.inquiries(tenant_id,id)
);
CREATE TABLE bookedradar_portal.source_ingestion_audit (
  tenant_id varchar(128) NOT NULL,
  inquiry_id varchar(128) NOT NULL,
  id uuid NOT NULL,
  service_actor text NOT NULL CHECK (service_actor='recovery_importer_v1'),
  action text NOT NULL CHECK (action IN ('inquiry.source_created','inquiry.source_refreshed')),
  fields text[] NOT NULL CHECK (cardinality(fields) BETWEEN 1 AND 6 AND fields <@ ARRAY['customerName','contact.email','contact.phone','subject','source','receivedAt']::text[] AND array_position(fields,NULL) IS NULL),
  previous_version bigint,
  version bigint NOT NULL CHECK (version BETWEEN 1 AND 9007199254740991),
  occurred_at timestamptz NOT NULL,
  CHECK ((action='inquiry.source_created' AND previous_version IS NULL AND version=1)
    OR (action='inquiry.source_refreshed' AND previous_version IS NOT NULL AND previous_version>=1 AND version=previous_version+1)),
  PRIMARY KEY (tenant_id,id),
  UNIQUE (tenant_id,inquiry_id,version),
  FOREIGN KEY (tenant_id,inquiry_id) REFERENCES bookedradar_portal.inquiries(tenant_id,id)
);
COMMIT;
