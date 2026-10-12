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
-- Identity bindings cannot be rebound by an accidental direct UPDATE either.
-- Ordinary importer updates only its fingerprint and observation timestamp.
CREATE FUNCTION bookedradar_portal.reject_source_link_rebind() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.tenant_id,NEW.inquiry_id,NEW.source_kind,NEW.source_opportunity_id,NEW.source_contact_key,NEW.source_event_id)
    IS DISTINCT FROM ROW(OLD.tenant_id,OLD.inquiry_id,OLD.source_kind,OLD.source_opportunity_id,OLD.source_contact_key,OLD.source_event_id) THEN
    RAISE EXCEPTION 'source_binding_immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER source_link_identity_immutable BEFORE UPDATE ON bookedradar_portal.source_links
FOR EACH ROW EXECUTE FUNCTION bookedradar_portal.reject_source_link_rebind();

CREATE TABLE bookedradar_portal.source_visibility (
  tenant_id varchar(128) NOT NULL,
  inquiry_id varchar(128) NOT NULL,
  state text NOT NULL CHECK (state IN ('active','quarantined')),
  revision bigint NOT NULL CHECK (revision BETWEEN 1 AND 9007199254740991),
  source_fingerprint char(64) NOT NULL CHECK (source_fingerprint ~ '^[a-f0-9]{64}$'),
  checked_at timestamptz NOT NULL,
  valid_until timestamptz,
  reason_code text,
  CHECK ((state='active' AND reason_code IS NULL AND valid_until IS NOT NULL
      AND valid_until>checked_at AND valid_until<=checked_at+INTERVAL '60 seconds')
    OR (state='quarantined' AND reason_code IS NOT NULL AND reason_code IN ('source_opportunity_missing','source_contact_missing','source_event_missing','source_tenant_mismatch','invalid_source_payload','source_column_id_mismatch','source_column_link_mismatch','invalid_source_event_id','source_column_time_mismatch','source_lineage_limit_exceeded','source_lineage_link_mismatch','source_lineage_contact_mismatch','source_binding_conflict','opportunity_required','contact_required','source_event_required','source_accessor_forbidden','invalid_source_metadata','invalid_synthetic_marker','source_synthetic_excluded','invalid_contact_key','contact_link_mismatch','contact_is_suppression_record','source_event_link_mismatch','source_opportunity_link_mismatch','invalid_source_type','source_type_mismatch','invalid_event_contact','invalid_event_contact_identity','source_contact_link_mismatch','source_contact_link_unresolved','invalid_contact_name','invalid_contact_email','invalid_contact_phone','invalid_source','invalid_service_type','invalid_source_time') AND valid_until IS NULL)),
  PRIMARY KEY (tenant_id,inquiry_id),
  FOREIGN KEY (tenant_id,inquiry_id) REFERENCES bookedradar_portal.source_links(tenant_id,inquiry_id)
);
CREATE TABLE bookedradar_portal.source_visibility_audit (
  tenant_id varchar(128) NOT NULL,
  inquiry_id varchar(128) NOT NULL,
  id uuid NOT NULL,
  service_actor text NOT NULL CHECK (service_actor='recovery_importer_v1'),
  action text NOT NULL CHECK (action IN ('source.verified','source.quarantined')),
  previous_revision bigint,
  revision bigint NOT NULL CHECK (revision BETWEEN 1 AND 9007199254740991),
  previous_state text CHECK (previous_state IN ('active','quarantined')),
  state text NOT NULL CHECK (state IN ('active','quarantined')),
  reason_code text,
  checked_at timestamptz NOT NULL,
  valid_until timestamptz,
  previous_version bigint,
  version bigint NOT NULL CHECK (version BETWEEN 1 AND 9007199254740991),
  CHECK ((previous_revision IS NULL AND revision=1 AND previous_state IS NULL)
    OR (previous_revision IS NOT NULL AND previous_revision>=1 AND revision=previous_revision+1 AND previous_state IS NOT NULL)),
  CHECK ((previous_version IS NULL AND version=1 AND previous_state IS NULL AND action='source.verified')
    OR (previous_version IS NOT NULL AND previous_version>=1 AND version BETWEEN previous_version AND previous_version+1)),
  CHECK (previous_state IS NULL OR previous_state=state OR version=previous_version+1),
  CHECK (previous_state IS DISTINCT FROM 'quarantined' OR state<>'quarantined' OR version=previous_version),
  CHECK ((action='source.verified' AND state='active' AND reason_code IS NULL AND valid_until IS NOT NULL
      AND valid_until>checked_at AND valid_until<=checked_at+INTERVAL '60 seconds')
    OR (action='source.quarantined' AND state='quarantined' AND reason_code IS NOT NULL AND reason_code IN ('source_opportunity_missing','source_contact_missing','source_event_missing','source_tenant_mismatch','invalid_source_payload','source_column_id_mismatch','source_column_link_mismatch','invalid_source_event_id','source_column_time_mismatch','source_lineage_limit_exceeded','source_lineage_link_mismatch','source_lineage_contact_mismatch','source_binding_conflict','opportunity_required','contact_required','source_event_required','source_accessor_forbidden','invalid_source_metadata','invalid_synthetic_marker','source_synthetic_excluded','invalid_contact_key','contact_link_mismatch','contact_is_suppression_record','source_event_link_mismatch','source_opportunity_link_mismatch','invalid_source_type','source_type_mismatch','invalid_event_contact','invalid_event_contact_identity','source_contact_link_mismatch','source_contact_link_unresolved','invalid_contact_name','invalid_contact_email','invalid_contact_phone','invalid_source','invalid_service_type','invalid_source_time') AND valid_until IS NULL)),
  PRIMARY KEY (tenant_id,id),
  UNIQUE (tenant_id,inquiry_id,revision),
  FOREIGN KEY (tenant_id,inquiry_id) REFERENCES bookedradar_portal.source_visibility(tenant_id,inquiry_id)
);
COMMIT;
